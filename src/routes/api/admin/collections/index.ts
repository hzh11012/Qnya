import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  type CollectionListQuery,
  CollectionListSchema,
  CollectionListSchemaResponse,
  type DeleteCollectionParams,
  DeleteCollectionParamsSchema
} from '../../../../schemas/collections.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, collectionsRepository, httpErrors } = fastify;

  /** 获取追番列表 */
  fastify.get<{ Querystring: CollectionListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: CollectionListSchema,
        response: {
          200: SuccessResponseSchema(CollectionListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const data = await collectionsRepository.findAll(request.query);
      return reply.success('获取追番列表成功', data);
    }
  );

  /** 删除追番 */
  fastify.delete<{ Params: DeleteCollectionParams }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: DeleteCollectionParamsSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const deleted = await collectionsRepository.deleteById(id);
      if (!deleted) {
        throw httpErrors.notFound('追番不存在');
      }

      return reply.success('删除追番成功');
    }
  );
}
