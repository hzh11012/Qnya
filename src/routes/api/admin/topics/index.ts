import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  type TopicListQuery,
  TopicListSchema,
  TopicListSchemaResponse,
  type AddTopicBody,
  AddTopicSchema,
  type UpdateTopicParams,
  UpdateTopicParamsSchema,
  type UpdateTopicBody,
  UpdateTopicBodySchema,
  type DeleteTopicParams,
  DeleteTopicParamsSchema
} from '../../../../schemas/topics.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, topicsRepository, httpErrors } = fastify;

  /** 创建专题 */
  fastify.post<{ Body: AddTopicBody }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        body: AddTopicSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { name } = request.body;

      const existing = await topicsRepository.findByName(name);
      if (existing) {
        throw httpErrors.conflict('专题名已存在');
      }

      await topicsRepository.create(request.body);
      return reply.success('创建专题成功');
    }
  );

  /** 获取专题列表 */
  fastify.get<{ Querystring: TopicListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: TopicListSchema,
        response: {
          200: SuccessResponseSchema(TopicListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const data = await topicsRepository.findAll(request.query);
      return reply.success('获取专题列表成功', data);
    }
  );

  /** 编辑专题 */
  fastify.put<{ Params: UpdateTopicParams; Body: UpdateTopicBody }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: UpdateTopicParamsSchema,
        body: UpdateTopicBodySchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const existing = await topicsRepository.findById(id);
      if (!existing) {
        throw httpErrors.notFound('专题不存在');
      }

      if (request.body.name !== undefined) {
        const duplicate = await topicsRepository.findByName(request.body.name);
        if (duplicate && duplicate.id !== id) {
          throw httpErrors.conflict('专题名已存在');
        }
      }

      await topicsRepository.update(id, request.body);
      return reply.success('编辑专题成功');
    }
  );

  /** 删除专题 */
  fastify.delete<{ Params: DeleteTopicParams }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: DeleteTopicParamsSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const deleted = await topicsRepository.deleteById(id);
      if (!deleted) {
        throw httpErrors.notFound('专题不存在');
      }

      return reply.success('删除专题成功');
    }
  );
}
