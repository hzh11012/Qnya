import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Server, type Socket } from 'socket.io';
import type {
  WatchRoomChatInput,
  WatchRoomJoinInput
} from '../../../schemas/watch-room.js';
import { RoomError } from '../../../utils/watch-room.js';

/**
 * 放映室实时通信（Socket.IO）
 *
 * Socket.IO 挂载在 Fastify HTTP server 上（握手请求不经过 Fastify 路由），
 * 随应用自动加载与 onClose 生命周期一并关闭。
 *
 * - 握手时校验 Session Cookie（复用现有登录体系，不引入 JWT）
 * - 单会话模型：账号唯一，新连接顶替旧连接
 * - 关键操作全部走 ACK 确认：{ success, data, error }
 */
declare module 'fastify' {
  interface FastifyInstance {
    /** 放映室 Socket.IO 实例 */
    watchRoomIo: Server;
  }
}

/** 统一 ACK 返回结构 */
const ok = (data: unknown = null) => ({
  success: true as const,
  data,
  error: null
});

const fail = (error: RoomError) => ({
  success: false as const,
  data: null,
  error: { code: error.code, message: error.message }
});

/** 事件处理器包裹：RoomError → ACK 错误结构，其余异常记录日志 */
const withAck = (handler: () => Promise<unknown>) =>
  Promise.resolve(handler())
    .then(data => ok(data))
    .catch((error: unknown) => {
      if (error instanceof RoomError) return fail(error);
      throw error;
    });

/** 聊天/操作频率限制（单实例内存滑动窗口） */
const RATE_LIMIT_WINDOW_MS = 60_000;

class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(private max: number) {}

  tryAcquire(key: string): boolean {
    const now = Date.now();
    const timestamps = (this.hits.get(key) ?? []).filter(
      t => now - t < RATE_LIMIT_WINDOW_MS
    );
    if (timestamps.length >= this.max) {
      this.hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return true;
  }
}

const registerWatchRoomSocket = async (fastify: FastifyInstance) => {
  const { sessionRepository, watchRoomConnections, watchRoomService, config } =
    fastify;
  const conn = watchRoomConnections;
  const service = watchRoomService;

  // 聊天限流：每用户每分钟 20 条
  const chatLimiter = new SlidingWindowLimiter(20);

  // 与 HTTP CORS 策略一致：白名单为空时拒绝跨域握手（同源不受影响）
  const corsAllowList = new Set(
    config.CORS_ORIGINS.split(',')
      .map(origin => origin.trim())
      .filter(Boolean)
  );

  const io = new Server(fastify.server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        callback(null, corsAllowList.has(origin));
      },
      credentials: true
    }
  });

  conn.setIo(io);
  fastify.decorate('watchRoomIo', io);

  // ============================================
  // 握手鉴权：复用 Session Cookie
  // ============================================

  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      if (!cookieHeader) return next(new Error('SESSION_INVALID'));

      // 复用 @fastify/cookie 实例装饰器：与 HTTP 路径同一套解析/验签实现
      const raw = fastify.parseCookie(cookieHeader)['session'];
      if (!raw) return next(new Error('SESSION_INVALID'));

      // 签名格式为 `s:<value>.<signature>`
      const unsigned = fastify.unsignCookie(raw);
      if (!unsigned.valid || !unsigned.value) {
        return next(new Error('SESSION_INVALID'));
      }

      const session = await sessionRepository.getSession(unsigned.value);
      if (!session || !session.status) {
        return next(new Error('SESSION_INVALID'));
      }

      // 放映室要求游客之上的角色（guest 不能进入放映室）
      if (!fastify.rbac.hasRoleAtLeast(session.role, 'user')) {
        return next(new Error('ROOM_PERMISSION_DENIED'));
      }

      socket.data.userId = session.userId;
      next();
    } catch {
      next(new Error('SESSION_INVALID'));
    }
  });

  // ============================================
  // 连接生命周期（单会话 + 断开即离开）
  // ============================================

  /** 将 socket 订阅到用户当前房间（接管后继承房间 / HTTP 加入后首连） */
  const attachSocketToCurrentRoom = async (socket: Socket) => {
    const userId = socket.data.userId as string;
    const roomId = await conn.getUserRoom(userId);
    if (!roomId) return;

    const state = await service.getCurrentRoom(userId).catch(() => null);
    if (!state) return; // 归属残留（房间已解散等），getCurrentRoom 已清理

    await conn.addSocket(socket.id, userId, roomId);
    await conn.markRoomOnline(roomId, userId);
    await socket.join([`room:${roomId}`, `user:${userId}`]);

    socket.emit('room:state', { roomId, state });
  };

  io.on('connection', socket => {
    const userId = socket.data.userId as string;
    fastify.log.debug(
      { userId, socketId: socket.id },
      'watch-room socket connected'
    );

    // 断开即离开：房主断开 → 解散；成员断开 → 退出房间。
    // 网络断开与主动离开同等处理（会话唯一，不做多设备保护）
    socket.on('disconnect', async () => {
      const info = await conn.removeSocket(socket.id);
      if (!info) return;

      // 会话已被新连接顶替：房间归属随账号转移，旧连接不触发离开逻辑
      const currentSocketId = await conn.getUserSocket(info.userId);
      if (currentSocketId) return;

      try {
        await service.disconnectLeave(info.userId, info.roomId);
      } catch (error) {
        fastify.log.error({ error }, 'watch-room disconnect leave failed');
      }
    });

    // ============================================
    // 客户端事件（全部 ACK 确认）
    // ============================================

    /** 加入房间：统一走 service.joinRoom（全平台单房间规则唯一入口） */
    socket.on(
      'room:join',
      async (
        payload: { roomId: string } & WatchRoomJoinInput,
        callback?: (result: unknown) => void
      ) => {
        const result = await withAck(async () => {
          const { roomId, ...input } = payload;
          const outcome = await service.joinRoom(userId, roomId, input);

          await conn.addSocket(socket.id, userId, roomId);
          await conn.markRoomOnline(roomId, userId);
          await socket.join(`room:${roomId}`);

          const state = await service.getRoomState(userId, roomId);
          return { alreadyJoined: outcome.alreadyJoined, state };
        }).catch((error: unknown) => {
          fastify.log.error({ error }, 'watch-room room:join failed');
          return fail(new RoomError('ROOM_SWITCH_FAILED', '加入房间失败'));
        });
        callback?.(result);
      }
    );

    socket.on('room:leave', async (callback?: (result: unknown) => void) => {
      const result = await withAck(() => service.leaveRoom(userId));
      callback?.(result);
    });

    socket.on(
      'room:close',
      async (
        payload: { roomId: string },
        callback?: (result: unknown) => void
      ) => {
        const result = await withAck(() =>
          service.closeRoom(userId, payload.roomId)
        );
        callback?.(result);
      }
    );

    socket.on(
      'room:update',
      async (
        payload: { roomId: string } & Record<string, unknown>,
        callback?: (result: unknown) => void
      ) => {
        const result = await withAck(() =>
          service.updateRoom(userId, payload.roomId, {
            ...(typeof payload.name === 'string' && { name: payload.name }),
            ...(typeof payload.announcement === 'string' && {
              announcement: payload.announcement
            })
          })
        );
        callback?.(result);
      }
    );

    socket.on(
      'member:kick',
      async (
        payload: { roomId: string; userId: string },
        callback?: (result: unknown) => void
      ) => {
        const result = await withAck(() =>
          service.kickMember(userId, payload.roomId, payload.userId)
        );
        callback?.(result);
      }
    );

    socket.on(
      'playback:play',
      async (
        payload: { roomId: string; position?: number },
        callback?: (result: unknown) => void
      ) => {
        const result = await withAck(() => {
          // 附带 position 时等价于先 seek 再播放，简化客户端实现
          return payload.position !== undefined
            ? service
                .controlPlayback(
                  userId,
                  payload.roomId,
                  'seek',
                  payload.position
                )
                .then(() =>
                  service.controlPlayback(userId, payload.roomId, 'play')
                )
            : service.controlPlayback(userId, payload.roomId, 'play');
        });
        callback?.(result);
      }
    );

    socket.on(
      'playback:pause',
      async (
        payload: { roomId: string },
        callback?: (result: unknown) => void
      ) => {
        const result = await withAck(() =>
          service.controlPlayback(userId, payload.roomId, 'pause')
        );
        callback?.(result);
      }
    );

    socket.on(
      'playback:seek',
      async (
        payload: { roomId: string; position: number },
        callback?: (result: unknown) => void
      ) => {
        const result = await withAck(() =>
          service.controlPlayback(
            userId,
            payload.roomId,
            'seek',
            payload.position
          )
        );
        callback?.(result);
      }
    );

    socket.on(
      'playback:change-video',
      async (
        payload: { roomId: string; videoId: string },
        callback?: (result: unknown) => void
      ) => {
        const result = await withAck(() =>
          service.controlPlayback(
            userId,
            payload.roomId,
            'change_video',
            payload.videoId
          )
        );
        callback?.(result);
      }
    );

    socket.on(
      'chat:send',
      async (
        payload: { roomId: string } & WatchRoomChatInput,
        callback?: (result: unknown) => void
      ) => {
        if (!chatLimiter.tryAcquire(userId)) {
          callback?.(
            fail(new RoomError('RATE_LIMITED', '发送太频繁，请稍后再试'))
          );
          return;
        }
        const result = await withAck(() =>
          service.sendChat(userId, payload.roomId, payload.content)
        );
        callback?.(result);
      }
    );

    // —— 连接建立后的异步会话接管与状态恢复 ——
    // 必须在所有事件监听器同步注册完成后执行：客户端可能在 connect
    // 后立即 emit，若此处先 await 会阻塞监听器注册导致事件被静默丢弃
    void (async () => {
      // 会话接管：账号唯一，新连接顶替旧连接。
      // 被顶替方先收到 session:replaced（前端据此退出并停止重连），
      // 再被强制断开；其 disconnect 处理器因活跃 socket 已指向新连接而跳过离开逻辑
      const displaced = await conn.setUserSocket(userId, socket.id);
      if (displaced) {
        const old = io.sockets.sockets.get(displaced);
        if (old) {
          old.emit('session:replaced', { socketId: socket.id });
          old.disconnect(true);
        }
      }

      await socket.join(`user:${userId}`);
      await attachSocketToCurrentRoom(socket);
    })().catch((error: unknown) => {
      fastify.log.error({ error }, 'watch-room connect setup failed');
    });
  });

  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing Socket.IO server...');
    await new Promise<void>(resolve => io.close(() => resolve()));
    fastify.log.info('Socket.IO server closed');
  });
};

export default fp(registerWatchRoomSocket, {
  name: 'watch-room-socket',
  dependencies: [
    'watch-room-service',
    'session-repository',
    'watch-room-connections',
    'rbac-middleware',
    '@fastify/cookie',
    '@fastify/env'
  ]
});
