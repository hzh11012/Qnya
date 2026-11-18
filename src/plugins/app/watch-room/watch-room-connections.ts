import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Server } from 'socket.io';

/**
 * 放映室实时连接管理（单会话模型：账号唯一，一个用户同时只有一条活跃连接）
 *
 * - 数据库保存成员关系（在房即在线），连接状态只在 Socket.IO 内存中
 * - Socket.IO 房间：`room:{roomId}` 房间广播 / `user:{userId}` 用户当前连接
 * - 仅支持单实例部署（多实例需引入 Redis Adapter 并改造会话接管）
 */
declare module 'fastify' {
  interface FastifyInstance {
    watchRoomConnections: ReturnType<typeof createWatchRoomConnections>;
  }
}

const createWatchRoomConnections = () => {
  /** Socket.IO Server 引用：由 sync-watch-room 插件启动时注入 */
  let io: Server | null = null;

  return {
    /** 注入 Socket.IO Server（应用启动时由 socket 插件调用） */
    setIo(server: Server) {
      io = server;
    },

    /** 向房间所有成员广播 */
    emitToRoom(roomId: string, event: string, payload: unknown) {
      io?.to(`room:${roomId}`).emit(event, payload);
    },

    /** 让用户的当前连接离开指定 Socket.IO 房间（切换/离开/踢人时清理） */
    dropUserFromRoom(userId: string, roomId: string) {
      io?.in(`user:${userId}`).socketsLeave(`room:${roomId}`);
    },

    /** 让房间内所有连接离开 Socket.IO 房间（解散时清理） */
    dropRoom(roomId: string) {
      io?.in(`room:${roomId}`).socketsLeave(`room:${roomId}`);
    },

    /** 强制断开用户的全部连接（账号停用时调用：已建立的连接不会重新握手鉴权） */
    disconnectUser(userId: string) {
      io?.in(`user:${userId}`).disconnectSockets(true);
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate('watchRoomConnections', createWatchRoomConnections());
  },
  {
    name: 'watch-room-connections'
  }
);
