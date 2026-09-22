import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Meilisearch } from 'meilisearch';

declare module 'fastify' {
  export interface FastifyInstance {
    /** Meilisearch 客户端 */
    meili: Meilisearch;
  }
}

/** 启动时等待 Meilisearch 就绪的重试窗口（容器编排下 meili 可能稍晚启动） */
const READY_TIMEOUT_MS = 30_000;
const READY_INTERVAL_MS = 2_000;

/**
 * This plugin adds a Meilisearch client to your app.
 *
 * Meilisearch 为必选依赖：启动时等待其就绪，超时则阻止应用启动（fail fast）。
 *
 * @see {@link https://github.com/meilisearch/meilisearch-js}
 */
const meilisearchPlugin = async (fastify: FastifyInstance) => {
  const { MEILI_URL, MEILI_MASTER_KEY } = fastify.config;

  const client = new Meilisearch({
    host: MEILI_URL,
    apiKey: MEILI_MASTER_KEY || undefined
  });

  fastify.decorate('meili', client);

  fastify.addHook('onReady', async () => {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      try {
        const health = await client.health();
        if (health.status === 'available') {
          fastify.log.info(`Meilisearch connection ready (${MEILI_URL})`);
          return;
        }
        fastify.log.warn(
          { status: health.status },
          'Meilisearch health check failed'
        );
      } catch (err) {
        if (Date.now() >= deadline) {
          // fail fast：搜索为必选依赖，无法连接时不启动应用
          fastify.log.error(
            { err, MEILI_URL },
            `Meilisearch is unreachable after ${READY_TIMEOUT_MS}ms, aborting startup`
          );
          throw err;
        }
        fastify.log.warn(
          `Meilisearch not ready yet (${MEILI_URL}), retrying in ${READY_INTERVAL_MS}ms...`
        );
      }
      await new Promise(resolve => setTimeout(resolve, READY_INTERVAL_MS));
    }
  });
};

export default fp(meilisearchPlugin, {
  name: 'meilisearch',
  dependencies: ['@fastify/env']
});
