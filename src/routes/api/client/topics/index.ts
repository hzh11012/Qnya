import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  ClientTopicListQuerySchema,
  ClientTopicListResponseSchema,
  ClientTopicDetailParamsSchema,
  ClientTopicDetailResponseSchema,
  type ClientTopicListQuery,
  type ClientTopicDetailParams
} from '../../../../schemas/topics.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, topicsRepository, httpErrors } = fastify;

  /** 获取已发布专题列表 */
  fastify.get<{ Querystring: ClientTopicListQuery }>(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        querystring: ClientTopicListQuerySchema,
        response: {
          200: SuccessResponseSchema(ClientTopicListResponseSchema)
        }
      }
    },
    async (request, reply) => {
      const data = await topicsRepository.findPublished(request.query);
      return reply.success('获取专题列表成功', data);
    }
  );

  /** 获取专题详情（含关联番剧） */
  fastify.get<{ Params: ClientTopicDetailParams }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.filterAdultTypes()],
      schema: {
        params: ClientTopicDetailParamsSchema,
        response: {
          200: SuccessResponseSchema(ClientTopicDetailResponseSchema)
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const data = await topicsRepository.findPublishedDetail(
        id,
        request.excludeTypes
      );

      if (!data) {
        throw httpErrors.notFound('专题不存在或未发布');
      }

      return reply.success('获取专题详情成功', data);
    }
  );
}
