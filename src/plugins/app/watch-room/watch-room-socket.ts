import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Server, type Socket } from 'socket.io';
import type { z } from 'zod';
import {
  WatchRoomCreateSchema,
  WatchRoomSocketChangeVideoSchema,
  WatchRoomSocketChatSchema,
  WatchRoomSocketJoinSchema,
  WatchRoomSocketKickSchema,
  WatchRoomSocketLeaveSchema,
  WatchRoomSocketPlaySchema,
  WatchRoomSocketRoomSchema,
  WatchRoomSocketSeekSchema,
  WatchRoomSocketUpdateSchema
} from '../../../schemas/watch-room.js';
import { RoomError } from '../../../utils/watch-room.js';
import type { SessionData } from '../auth/session-repository.js';

/**
 * 放映室实时通信（Socket.IO）
 *
 * Socket.IO 挂载在 Fastify HTTP server 上（握手请求不经过 Fastify 路由），
 * 随应用自动加载与 onClose 生命周期一并关闭。
 *
 * - 握手时校验 Session Cookie（复用现有登录体系，不引入 JWT）
 * - 每个事件重新校验会话、校验载荷并限流；同一连接的事件串行执行
 * - 单会话模型：账号唯一，新连接顶替旧连接
 * - 断线保留 30s 宽限期（网络闪断/刷新不散房），超时才真正离开
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

type AckResult = ReturnType<typeof ok> | ReturnType<typeof fail>;

/** ACK 回调（约定为事件的最后一个参数；客户端不需要确认时可省略） */
type Ack = (result: AckResult) => void;

/** 事件频率限制（单实例内存滑动窗口，按用户计数） */
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * 断线宽限期（ms）：连接异常断开后先保留席位，等客户端 Socket.IO 自动重连。
 * 网络闪断、手机切网、页面刷新都不该让房主掉线即散房；超时未回来才真正离开。
 * 前端 room.tsx 的 RECONNECT_GRACE_MS 与此对齐。
 */
const DISCONNECT_GRACE_MS = 30_000;

class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private max: number,
    readonly message = '操作太频繁，请稍后再试'
  ) {}

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

  /** 清除窗口内已无记录的用户（避免 Map 随历史用户数无限增长） */
  prune() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits) {
      const last = timestamps[timestamps.length - 1] ?? 0;
      if (now - last >= RATE_LIMIT_WINDOW_MS) this.hits.delete(key);
    }
  }
}

const registerWatchRoomSocket = async (fastify: FastifyInstance) => {
  const {
    sessionRepository,
    watchRoomConnections,
    watchRoomService,
    rbac,
    config
  } = fastify;
  const conn = watchRoomConnections;
  const service = watchRoomService;

  // 每用户每分钟：聊天 20 条；建房/加入 15 次（同时限制房间密码猜测）；
  // 其余操作 120 次（房主拖动进度条会连续触发 seek）
  const chatLimiter = new SlidingWindowLimiter(20, '发送太频繁，请稍后再试');
  const joinLimiter = new SlidingWindowLimiter(15);
  const actionLimiter = new SlidingWindowLimiter(120);

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

  /**
   * 待执行的断线离开（userId → 定时器）。重连、主动离开都会取消。
   * 与限流一样是单实例内存实现：多实例部署需换成 Redis 延迟队列，
   * 否则宽限期只在接住该连接的那个实例上有效。
   */
  const pendingLeaves = new Map<string, NodeJS.Timeout>();

  const cancelPendingLeave = (userId: string) => {
    const timer = pendingLeaves.get(userId);
    if (!timer) return;
    clearTimeout(timer);
    pendingLeaves.delete(userId);
  };

  conn.setIo(io);
  fastify.decorate('watchRoomIo', io);

  // 定期清除限流器中窗口已过期的用户（避免 Map 随历史用户数无限增长）
  let pruneTimer: NodeJS.Timeout | undefined;
  fastify.addHook('onReady', () => {
    pruneTimer = setInterval(() => {
      chatLimiter.prune();
      joinLimiter.prune();
      actionLimiter.prune();
    }, RATE_LIMIT_WINDOW_MS);
    // 不阻止进程退出
    pruneTimer.unref();
  });

  // 启动时清理上次关闭/崩溃残留的房间（刚开始监听，客户端还没重连回来）。
  // 用 onListen 而非 onReady：openapi 导出脚本只调用 ready()，不能误删房间
  fastify.addHook('onListen', async () => {
    const count = await service.clearAllRooms();
    fastify.log.info({ count }, 'watch-room stale rooms cleared');
  });

  // ============================================
  // 握手鉴权：复用 Session Cookie
  // ============================================

  io.use(async (socket, next) => {
    try {
      // 白名单非空时显式校验 Origin：engine.io 的 cors 只作用于 HTTP 轮询，
      // 直连 wss 的 upgrade 不会命中，靠这一条挡住跨站 WebSocket 劫持（CSWSH）。
      // 非浏览器客户端不带 Origin，放行。
      const origin = socket.handshake.headers.origin;
      if (origin && corsAllowList.size > 0 && !corsAllowList.has(origin)) {
        fastify.log.warn({ origin }, 'watch-room socket origin rejected');
        return next(new Error('SESSION_INVALID'));
      }

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
      if (!rbac.hasRoleAtLeast(session.role, 'user')) {
        return next(new Error('ROOM_PERMISSION_DENIED'));
      }

      socket.data.userId = session.userId;
      // 连接时恢复房间状态按握手角色过滤内容（后续事件按复核后的会话角色）
      socket.data.role = session.role;
      // 保存会话凭证：后续每个事件据此复核会话是否仍然有效
      socket.data.sessionToken = unsigned.value;
      next();
    } catch {
      next(new Error('SESSION_INVALID'));
    }
  });

  // ============================================
  // 连接生命周期（单会话 + 断线宽限期）
  // ============================================

  /**
   * 将 socket 订阅到用户当前房间（会话接管后新连接继承房间）。
   * 不在任何房间时也推送 room:state（state 为 null）：断线期间房间已解散 /
   * 已被移出的客户端收不到当时的广播，前端据此退出房间页
   */
  const attachSocketToCurrentRoom = async (socket: Socket) => {
    const userId = socket.data.userId as string;
    let state: Awaited<ReturnType<typeof service.getCurrentRoom>>;
    try {
      state = await service.getCurrentRoom(
        userId,
        rbac.excludeTypesFor(socket.data.role as string)
      );
    } catch (error) {
      // 连接初始化期间房间刚好被解散/删除：照「不在任何房间」处理，
      // 否则客户端既收不到 room:state 也不知道房间没了，会一直卡在房间页
      if (error instanceof RoomError) {
        socket.emit('room:state', { roomId: null, state: null });
        return;
      }
      throw error;
    }
    if (!state) {
      socket.emit('room:state', { roomId: null, state: null });
      return;
    }

    const roomId = state.id;
    await socket.join(`room:${roomId}`);

    socket.emit('room:state', { roomId, state });
  };

  io.on('connection', socket => {
    const userId = socket.data.userId as string;
    const sessionToken = socket.data.sessionToken as string;
    fastify.log.debug(
      { userId, socketId: socket.id },
      'watch-room socket connected'
    );

    // 宽限期内重连：撤销待执行的离开，席位与播放状态原样保留
    cancelPendingLeave(userId);

    // 会话接管：账号唯一，新连接顶替旧连接。先同步加入 `user:` 房间再断开旧连接，
    // 旧连接的断开处理据此识别"已被顶替"而跳过离开逻辑；
    // 被顶替方先收到 session:replaced（前端据此退出并停止重连）
    const userRoom = `user:${userId}`;
    const previous = [...(io.sockets.adapter.rooms.get(userRoom) ?? [])];
    void socket.join(userRoom);
    for (const id of previous) {
      const old = io.sockets.sockets.get(id);
      old?.emit('session:replaced', { socketId: socket.id });
      old?.disconnect(true);
    }

    /**
     * 本连接的串行任务队列：连接初始化、客户端事件、断开清理按到达顺序逐个执行。
     * 单个连接同时最多占用一个数据库连接；初始化/加入/断开清理也不会交错，
     * 避免 Socket.IO 房间订阅与数据库成员关系不一致
     */
    let queue: Promise<void> = Promise.resolve();
    const enqueue = (label: string, task: () => Promise<void>) => {
      queue = queue.then(task).catch((error: unknown) => {
        fastify.log.error(
          { error, userId, socketId: socket.id },
          `watch-room ${label} failed`
        );
      });
    };

    // 断线进入宽限期：期间席位不动（成员列表不变），客户端重连后由
    // attachSocketToCurrentRoom 重新补齐状态；超时未回来才真正离开。
    // 房主超时 → 解散；普通成员超时 → 退出。
    socket.on('disconnect', () => {
      // 会话已被新连接顶替：房间归属随账号转移，旧连接不触发离开逻辑
      if (io.sockets.adapter.rooms.has(userRoom)) return;
      // 同一用户可能有多个连接各自触发 disconnect，只保留一个计时器
      if (pendingLeaves.has(userId)) return;

      const timer = setTimeout(() => {
        pendingLeaves.delete(userId);
        // 兜底：计时器到点时用户已重新连上（取消动作因竞态漏掉）
        if (io.sockets.adapter.rooms.has(userRoom)) return;
        void service.disconnectLeave(userId).catch((error: unknown) => {
          fastify.log.error(
            { error, userId },
            'watch-room disconnect leave failed'
          );
        });
      }, DISCONNECT_GRACE_MS);
      // 宽限计时不阻止进程退出
      timer.unref();
      pendingLeaves.set(userId, timer);
    });

    /**
     * 执行单个事件：会话复核 → 载荷校验 → 业务处理。
     * 所有异常都转换为 ACK 错误结构，不抛给 Socket.IO（监听器返回的
     * Promise 被拒绝时无人处理，会以 unhandledRejection 终止进程）
     */
    const execute = async <S extends z.ZodType>(
      event: string,
      schema: S,
      payload: unknown,
      handler: (data: z.output<S>, session: SessionData) => Promise<unknown>
    ): Promise<AckResult> => {
      try {
        // 握手只校验一次：登出、停用、降级后，已建立的连接必须在事件层面失效
        const session = await sessionRepository.getSession(sessionToken);
        if (
          !session ||
          !session.status ||
          !rbac.hasRoleAtLeast(session.role, 'user')
        ) {
          return fail(
            new RoomError('SESSION_INVALID', '登录已失效，请重新登录')
          );
        }

        // Socket.IO 载荷不经过 Fastify schema 校验，必须显式解析
        const parsed = schema.safeParse(payload ?? {});
        if (!parsed.success) {
          return fail(
            new RoomError(
              'INVALID_PARAMS',
              parsed.error.issues[0]?.message ?? '参数错误'
            )
          );
        }

        return ok(await handler(parsed.data, session));
      } catch (error) {
        if (error instanceof RoomError) return fail(error);
        fastify.log.error(
          { error, event, userId },
          'watch-room socket event failed'
        );
        return fail(new RoomError('INTERNAL_ERROR', '操作失败，请稍后再试'));
      }
    };

    // ============================================
    // 客户端事件（全部 ACK 确认）
    // ============================================

    /** 注册事件：限流 → 入队执行 → ACK；会话失效时回复 ACK 后断开连接 */
    const handle = <S extends z.ZodType>(
      event: string,
      schema: S,
      limiter: SlidingWindowLimiter,
      handler: (data: z.output<S>, session: SessionData) => Promise<unknown>
    ) => {
      socket.on(event, (...args: unknown[]) => {
        const last = args[args.length - 1];
        const ack =
          typeof last === 'function' ? (args.pop() as Ack) : undefined;

        // 入队前限流：超限事件直接拒绝，不占用队列与数据库连接
        if (!limiter.tryAcquire(userId)) {
          ack?.(fail(new RoomError('RATE_LIMITED', limiter.message)));
          return;
        }

        enqueue(event, async () => {
          const result = await execute(event, schema, args[0], handler);
          ack?.(result);
          if (!result.success && result.error.code === 'SESSION_INVALID') {
            socket.disconnect(true);
          }
        });
      });
    };

    /** 创建房间：创建者成为房主并进入房间（已在其他房间时按切换规则处理） */
    handle(
      'room:create',
      WatchRoomCreateSchema,
      joinLimiter,
      async (input, session) => {
        // 按当前会话角色过滤：初始视频不能是无权观看的内容
        const excludeTypes = rbac.excludeTypesFor(session.role);
        const room = await service.createRoom(userId, input, excludeTypes);
        await socket.join(`room:${room.id}`);

        const state = await service.getRoomState(userId, room.id, excludeTypes);
        return { state };
      }
    );

    /** 加入房间：统一走 service.joinRoom（全平台单房间规则唯一入口） */
    handle(
      'room:join',
      WatchRoomSocketJoinSchema,
      joinLimiter,
      async ({ roomId, ...input }, session) => {
        // 按当前会话角色过滤：房间正在播放无权观看的内容时拒绝加入
        const excludeTypes = rbac.excludeTypesFor(session.role);
        const outcome = await service.joinRoom(
          userId,
          roomId,
          input,
          excludeTypes
        );
        await socket.join(`room:${roomId}`);

        const state = await service.getRoomState(userId, roomId, excludeTypes);
        return { alreadyJoined: outcome.alreadyJoined, state };
      }
    );

    /** 离开房间（传 roomId 时只离开该房间，不会误退出已切换到的新房间） */
    handle(
      'room:leave',
      WatchRoomSocketLeaveSchema,
      actionLimiter,
      ({ roomId }) => service.leaveRoom(userId, { roomId })
    );

    handle(
      'room:update',
      WatchRoomSocketUpdateSchema,
      actionLimiter,
      ({ roomId, ...patch }) => service.updateRoom(userId, roomId, patch)
    );

    handle(
      'member:kick',
      WatchRoomSocketKickSchema,
      actionLimiter,
      ({ roomId, userId: targetUserId }) =>
        service.kickMember(userId, roomId, targetUserId)
    );

    // 附带 position 时从该位置开始播放（单次事务，只产生一次 sync）
    handle(
      'playback:play',
      WatchRoomSocketPlaySchema,
      actionLimiter,
      ({ roomId, position }) =>
        service.controlPlayback(userId, roomId, 'play', position)
    );

    handle(
      'playback:pause',
      WatchRoomSocketRoomSchema,
      actionLimiter,
      ({ roomId }) => service.controlPlayback(userId, roomId, 'pause')
    );

    handle(
      'playback:seek',
      WatchRoomSocketSeekSchema,
      actionLimiter,
      ({ roomId, position }) =>
        service.controlPlayback(userId, roomId, 'seek', position)
    );

    // 只读拉取（客户端周期校准）：不走 controlPlayback，不产生 revision 与广播
    handle(
      'playback:pull',
      WatchRoomSocketRoomSchema,
      actionLimiter,
      ({ roomId }) => service.pullPlayback(userId, roomId)
    );

    // 按当前会话角色过滤可切换的视频（无 adult 权限的房主不能切到 adult 视频）
    handle(
      'playback:change-video',
      WatchRoomSocketChangeVideoSchema,
      actionLimiter,
      ({ roomId, videoId, autoplay }, session) =>
        service.controlPlayback(
          userId,
          roomId,
          'change_video',
          videoId,
          rbac.excludeTypesFor(session.role),
          autoplay ?? false
        )
    );

    handle(
      'chat:send',
      WatchRoomSocketChatSchema,
      chatLimiter,
      ({ roomId, content }) => service.sendChat(userId, roomId, content)
    );

    // —— 连接建立后恢复房间状态（会话接管时新连接继承房间）——
    // 监听器注册与入队都是同步的：客户端在 connect 后立即 emit 的事件
    // 不会丢失，并且一定排在初始化之后执行
    enqueue('connect setup', () => attachSocketToCurrentRoom(socket));
  });

  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing Socket.IO server...');
    if (pruneTimer) clearInterval(pruneTimer);
    for (const timer of pendingLeaves.values()) clearTimeout(timer);
    pendingLeaves.clear();
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
