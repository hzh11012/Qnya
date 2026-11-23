import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createWatchRoomChat } from './internal/watch-room-chat.js';
import { createWatchRoomCore } from './internal/watch-room-core.js';
import { createWatchRoomLifecycle } from './internal/watch-room-lifecycle.js';
import { createWatchRoomPlayback } from './internal/watch-room-playback.js';
import { createWatchRoomQuery } from './internal/watch-room-query.js';

declare module 'fastify' {
  interface FastifyInstance {
    watchRoomService: ReturnType<typeof createWatchRoomService>;
  }
}

/**
 * 放映室领域服务。
 *
 * 对外是一个聚合对象（路由 / Socket 只依赖它），内部按职责拆分：
 * - core       事务基元：行锁、成员校验、消息写入、提交后广播
 * - lifecycle  建房 / 加入 / 离开 / 踢人 / 编辑 / 断线清理
 * - query      大厅、详情、成员状态、消息历史
 * - playback   播放同步（仅房主）
 * - chat       聊天消息
 *
 * 启动清理遗留房间放在 socket 插件的 onListen（见 watch-room-socket.ts）：
 * 那里才是「真的开始监听」，openapi 导出脚本只跑 ready()，不能误删房间。
 */
const createWatchRoomService = (fastify: FastifyInstance) => {
  const core = createWatchRoomCore(fastify);

  return {
    ...createWatchRoomLifecycle(core),
    ...createWatchRoomQuery(core),
    ...createWatchRoomPlayback(core),
    ...createWatchRoomChat(core)
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate('watchRoomService', createWatchRoomService(fastify));
  },
  {
    name: 'watch-room-service',
    dependencies: [
      'redis',
      'watch-room-repository',
      'watch-room-connections',
      'rbac-middleware'
    ]
  }
);
