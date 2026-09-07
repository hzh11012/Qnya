import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  type ScoreListQuery,
  ScoreListSchema,
  ScoreListSchemaResponse,
  type DeleteScoreParams,
  DeleteScoreParamsSchema,
  type UpdateScoreParams,
  UpdateScoreParamsSchema,
  type UpdateScoreBody,
  UpdateScoreBodySchema
} from '../../../../schemas/scores.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, scoresRepository, httpErrors } = fastify;

  /** 获取评分列表 */
  fastify.get<{ Querystring: ScoreListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: ScoreListSchema,
        response: {
          200: SuccessResponseSchema(ScoreListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const data = await scoresRepository.findAll(request.query);
      return reply.success('获取评分列表成功', data);
    }
  );

  /** 更新评分 */
  fastify.put<{ Params: UpdateScoreParams; Body: UpdateScoreBody }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: UpdateScoreParamsSchema,
        body: UpdateScoreBodySchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const existing = await scoresRepository.findById(id);
      if (!existing) {
        throw httpErrors.notFound('评分不存在');
      }

      await scoresRepository.update(id, request.body);
      return reply.success('更新评分成功');
    }
  );

  /** 删除评分 */
  fastify.delete<{ Params: DeleteScoreParams }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: DeleteScoreParamsSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const deleted = await scoresRepository.deleteById(id);
      if (!deleted) {
        throw httpErrors.notFound('评分不存在');
      }

      return reply.success('删除评分成功');
    }
  );
}
