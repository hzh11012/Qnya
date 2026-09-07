import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  type HistoryListQuery,
  HistoryListSchema,
  HistoryListSchemaResponse,
  type DeleteHistoryParams,
  DeleteHistoryParamsSchema
} from '../../../../schemas/histories.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, historiesRepository, httpErrors } = fastify;

  /** 获取观看记录列表 */
  fastify.get<{ Querystring: HistoryListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: HistoryListSchema,
        response: {
          200: SuccessResponseSchema(HistoryListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const data = await historiesRepository.findAll(request.query);
      return reply.success('获取观看记录列表成功', data);
    }
  );

  /** 删除观看记录 */
  fastify.delete<{ Params: DeleteHistoryParams }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: DeleteHistoryParamsSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const deleted = await historiesRepository.deleteById(id);
      if (!deleted) {
        throw httpErrors.notFound('观看记录不存在');
      }

      return reply.success('删除观看记录成功');
    }
  );
}
