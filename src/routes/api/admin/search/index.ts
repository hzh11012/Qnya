import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, animeSearch } = fastify;

  /** 手动全量重建番剧搜索索引 */
  fastify.post(
    '/reindex',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (_request, reply) => {
      await animeSearch.reindexAll();
      return reply.success('番剧搜索索引重建完成');
    }
  );
}
