import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Server } from 'socket.io';

/**
 * 放映室实时连接管理（单会话模型：账号唯一，一个用户同时只有一条活跃连接）
 *
 * - 新连接顶替旧连接（会话接管），房间归属跟随账号而非设备
 * - 数据库保存业务成员关系，Redis 维护连接/在线状态
 * - Socket ID 绝不作为用户身份：redis 仅存 userId ↔ socketId ↔ roomId 的映射
 * - 单实例 V1.1 直接用 Socket.IO 默认 Adapter 广播；多实例时仅需引入
 *   Redis Adapter，本模块的 Redis key 结构与广播接口无需变化
 */
declare module 'fastify' {
  interface FastifyInstance {
    watchRoomConnections: ReturnType<typeof createWatchRoomConnections>;
  }
}

const USER_ROOM_PREFIX = 'wr:user_room:';
const CONN_PREFIX = 'wr:conn:';
/** 用户当前活跃 socket（单值，新连接顶替旧值） */
const USER_SOCKET_PREFIX = 'wr:user_socket:';
const ROOM_ONLINE_PREFIX = 'wr:room_online:';
/** 连接映射兜底 TTL：异常未清理的连接记录 24h 后自动过期 */
const CONN_TTL_SECONDS = 86400;

interface SocketConnInfo {
  userId: string;
  roomId: string;
}

const createWatchRoomConnections = (fastify: FastifyInstance) => {
  const redis = fastify.redis;

  /** Socket.IO Server 引用：由 sync-watch-room 插件启动时注入 */
  let io: Server | null = null;

  return {
    /** 注入 Socket.IO Server（应用启动时由 socket 插件调用） */
    setIo(server: Server) {
      io = server;
    },

    // ============================================
    // 广播（Socket.IO 房间 = `room:{roomId}` / `user:{userId}`）
    // ============================================

    /** 向房间所有成员广播 */
    emitToRoom(roomId: string, event: string, payload: unknown) {
      io?.to(`room:${roomId}`).emit(event, payload);
    },

    /** 向用户的当前连接广播 */
    emitToUser(userId: string, event: string, payload: unknown) {
      io?.to(`user:${userId}`).emit(event, payload);
    },

    /** 让用户的当前连接离开指定 Socket.IO 房间（切换/离开/踢人时清理） */
    dropUserFromRoom(userId: string, roomId: string) {
      io?.in(`user:${userId}`).socketsLeave(`room:${roomId}`);
    },

    /** 让房间内所有连接离开 Socket.IO 房间（解散时清理） */
    dropRoom(roomId: string) {
      io?.in(`room:${roomId}`).socketsLeave(`room:${roomId}`);
    },

    // ============================================
    // 用户当前房间归属（全平台单房间限制的核心）
    // ============================================

    /** 获取用户当前所在房间（无则 null） */
    async getUserRoom(userId: string): Promise<string | null> {
      return (await redis.get(`${USER_ROOM_PREFIX}${userId}`)) ?? null;
    },

    /** 设置用户当前房间 */
    async setUserRoom(userId: string, roomId: string): Promise<void> {
      await redis.set(`${USER_ROOM_PREFIX}${userId}`, roomId);
    },

    /** 清除用户当前房间（仅当归属仍是本房间时才清除，避免覆盖并发加入的新归属） */
    async clearUserRoom(userId: string, roomId: string): Promise<void> {
      await redis.eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then
           return redis.call('del', KEYS[1])
         end
         return 0`,
        1,
        `${USER_ROOM_PREFIX}${userId}`,
        roomId
      );
    },

    // ============================================
    // 连接映射（单会话：user → 唯一活跃 socketId）
    // ============================================

    /**
     * 会话接管：将用户的活跃 socket 设为新连接
     * @returns 被顶替的旧 socketId（无旧连接返回 null）
     */
    async setUserSocket(
      userId: string,
      socketId: string
    ): Promise<string | null> {
      const old = await redis.getset(
        `${USER_SOCKET_PREFIX}${userId}`,
        socketId
      );
      return old && old !== socketId ? old : null;
    },

    /** 获取用户当前的活跃 socketId */
    async getUserSocket(userId: string): Promise<string | null> {
      return (await redis.get(`${USER_SOCKET_PREFIX}${userId}`)) ?? null;
    },

    /** 记录连接的房间上下文（socketId → userId/roomId） */
    async addSocket(socketId: string, userId: string, roomId: string) {
      await redis.setex(
        `${CONN_PREFIX}${socketId}`,
        CONN_TTL_SECONDS,
        JSON.stringify({ userId, roomId } satisfies SocketConnInfo)
      );
    },

    /**
     * 移除连接记录（断开时调用）。
     * 用户活跃 socket 指向此连接时才清除映射（会话接管场景不清除，
     * 让断开处理器识别出"已被顶替"从而跳过离开逻辑）
     */
    async removeSocket(socketId: string): Promise<SocketConnInfo | null> {
      const raw = await redis.get(`${CONN_PREFIX}${socketId}`);
      if (!raw) return null;

      const info = JSON.parse(raw) as SocketConnInfo;
      const pipeline = redis.pipeline();
      pipeline.del(`${CONN_PREFIX}${socketId}`);
      // 仅当活跃 socket 仍指向此连接时清除（新连接顶替后不清，供断开处理识别）
      pipeline.eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then
           return redis.call('del', KEYS[1])
         end
         return 0`,
        1,
        `${USER_SOCKET_PREFIX}${info.userId}`,
        socketId
      );
      await pipeline.exec();
      return info;
    },

    // ============================================
    // 房间在线状态（单会话模型下，在房成员即在线成员）
    // ============================================

    /** 标记用户在线（在线人数展示用） */
    async markRoomOnline(roomId: string, userId: string): Promise<void> {
      await redis.sadd(`${ROOM_ONLINE_PREFIX}${roomId}`, userId);
    },

    /** 标记用户离线 */
    async markRoomOffline(roomId: string, userId: string): Promise<void> {
      await redis.srem(`${ROOM_ONLINE_PREFIX}${roomId}`, userId);
    },

    /** 房间在线成员 userId 列表 */
    async getRoomOnlineUsers(roomId: string): Promise<string[]> {
      return redis.smembers(`${ROOM_ONLINE_PREFIX}${roomId}`);
    },

    /** 清空房间在线集合与用户归属（解散时调用） */
    async clearRoomState(roomId: string, memberUserIds: string[]) {
      const pipeline = redis.pipeline();
      pipeline.del(`${ROOM_ONLINE_PREFIX}${roomId}`);
      for (const userId of memberUserIds) {
        // 仅当归属仍是本房间时才清除
        pipeline.eval(
          `if redis.call('get', KEYS[1]) == ARGV[1] then
             return redis.call('del', KEYS[1])
           end
           return 0`,
          1,
          `${USER_ROOM_PREFIX}${userId}`,
          roomId
        );
      }
      await pipeline.exec();
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate(
      'watchRoomConnections',
      createWatchRoomConnections(fastify)
    );
  },
  {
    name: 'watch-room-connections',
    dependencies: ['redis']
  }
);
