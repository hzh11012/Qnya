import type { FastifyInstance } from 'fastify';
import {
  SuccessResponseSchema,
  OptionSchemaResponse
} from '../../../../schemas/common.js';
import {
  TagsListSchema,
  TagsListSchemaResponse,
  type TagsListQuery
} from '../../../../schemas/tags.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, tagsRepository } = fastify;

  /** 标签列表 */
  fastify.get<{ Querystring: TagsListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: TagsListSchema,
        response: {
          200: SuccessResponseSchema(TagsListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const data = await tagsRepository.findAll(request.query);
      return reply.success('获取标签列表成功', data);
    }
  );

  /** 标签选项 */
  fastify.get(
    '/options',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        response: {
          200: SuccessResponseSchema(OptionSchemaResponse)
        }
      }
    },
    async (_request, reply) => {
      const data = await tagsRepository.findAllOptions();
      return reply.success('获取标签选项成功', data);
    }
  );
}
