import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import { RecommendStatusResponseSchema } from '../../../../schemas/recommend.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, recommendRepository } = fastify;

  /** 推荐系统状态：共现矩阵最近重建时间、亲和记录数、可推荐番剧数 */
  fastify.get(
    '/status',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        response: {
          200: SuccessResponseSchema(RecommendStatusResponseSchema)
        }
      }
    },
    async (_request, reply) => {
      const data = await recommendRepository.getStatus();
      return reply.success('获取推荐系统状态成功', data);
    }
  );

  /** 手动全量重建猜你喜欢共现矩阵 */
  fastify.post(
    '/refresh',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (_request, reply) => {
      await recommendRepository.refreshAffinity();
      return reply.success('猜你喜欢共现矩阵重建完成');
    }
  );
}
