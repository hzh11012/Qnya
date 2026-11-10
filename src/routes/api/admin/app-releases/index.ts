import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  type AppReleaseIdParams,
  AppReleaseIdParamsSchema,
  type AppReleaseListQuery,
  AppReleaseListSchema,
  AppReleaseListSchemaResponse,
  type CreateAppReleaseBody,
  CreateAppReleaseBodySchema,
  type UpdateAppReleaseBody,
  UpdateAppReleaseBodySchema
} from '../../../../schemas/app.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, appReleaseRepository, httpErrors } = fastify;

  /** 获取版本发布列表 */
  fastify.get<{ Querystring: AppReleaseListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: AppReleaseListSchema,
        response: {
          200: SuccessResponseSchema(AppReleaseListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const data = await appReleaseRepository.findAll(request.query);
      return reply.success('获取版本列表成功', data);
    }
  );

  /** 发布新版本 */
  fastify.post<{ Body: CreateAppReleaseBody }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        body: CreateAppReleaseBodySchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      await appReleaseRepository.create(request.body);
      return reply.success('发布版本成功');
    }
  );

  /** 修改版本发布记录 */
  fastify.put<{ Params: AppReleaseIdParams; Body: UpdateAppReleaseBody }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: AppReleaseIdParamsSchema,
        body: UpdateAppReleaseBodySchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const updated = await appReleaseRepository.updateById(id, request.body);
      if (!updated) {
        throw httpErrors.notFound('版本发布记录不存在');
      }

      return reply.success('修改版本记录成功');
    }
  );

  /** 删除版本发布记录 */
  fastify.delete<{ Params: AppReleaseIdParams }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: AppReleaseIdParamsSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const deleted = await appReleaseRepository.deleteById(id);
      if (!deleted) {
        throw httpErrors.notFound('版本发布记录不存在');
      }

      return reply.success('删除版本记录成功');
    }
  );
}
