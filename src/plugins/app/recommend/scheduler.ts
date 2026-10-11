import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/** 共现矩阵刷新周期：6 小时 */
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * 协同过滤共现矩阵定时刷新：
 * 启动时（onReady）若数据缺失或过期则后台重建（不阻塞启动），
 * 之后按固定周期轮询刷新；服务关闭时清理定时器
 */
export default fp(
  async (fastify: FastifyInstance) => {
    let timer: NodeJS.Timeout | undefined;

    const refreshIfStale = async () => {
      try {
        const last = await fastify.recommendRepository.getLastRefreshedAt();
        if (last && Date.now() - last.getTime() < REFRESH_INTERVAL_MS) return;
        await fastify.recommendRepository.refreshAffinity();
        fastify.log.info('recommend: anime affinity matrix refreshed');
      } catch (err) {
        fastify.log.error(err, 'recommend: anime affinity refresh failed');
      }
    };

    fastify.addHook('onReady', () => {
      // 异步执行，不阻塞 onReady
      void refreshIfStale();
      timer = setInterval(() => void refreshIfStale(), REFRESH_INTERVAL_MS);
      // 不阻止进程退出
      timer.unref();
    });

    fastify.addHook('onClose', async () => {
      if (timer) clearInterval(timer);
    });
  },
  { name: 'recommend-scheduler', dependencies: ['recommend-repository'] }
);
