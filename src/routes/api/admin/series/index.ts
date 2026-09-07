import type { FastifyInstance } from 'fastify';
import {
  SuccessResponseSchema,
  OptionSchemaResponse
} from '../../../../schemas/common.js';
import {
  type AddSeriesBody,
  AddSeriesSchema,
  type SeriesListQuery,
  SeriesListSchema,
  SeriesListSchemaResponse,
  type DeleteSeriesBody,
  DeleteSeriesSchema
} from '../../../../schemas/series.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, seriesRepository, httpErrors } = fastify;

  /** 创建系列 */
  fastify.post<{ Body: AddSeriesBody }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        body: AddSeriesSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { name } = request.body;

      const existing = await seriesRepository.findByName(name);
      if (existing) {
        throw httpErrors.conflict('系列已存在');
      }

      await seriesRepository.create({ name });
      return reply.success('创建系列成功');
    }
  );

  /** 系列列表 */
  fastify.get<{ Querystring: SeriesListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: SeriesListSchema,
        response: {
          200: SuccessResponseSchema(SeriesListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const data = await seriesRepository.findAll(request.query);
      return reply.success('获取系列列表成功', data);
    }
  );

  /** 删除系列 */
  fastify.delete<{ Params: DeleteSeriesBody }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: DeleteSeriesSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      // 直接删除并检查影响行数，避免多余的一次查询
      const deleted = await seriesRepository.deleteById(id);
      if (!deleted) {
        throw httpErrors.notFound('系列不存在');
      }

      return reply.success('删除系列成功');
    }
  );

  /** 系列选项 */
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
      const data = await seriesRepository.findAllOptions();
      return reply.success('获取系列选项成功', data);
    }
  );
}
