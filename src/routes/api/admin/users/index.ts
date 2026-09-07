import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  type UserListQuery,
  UserListSchema,
  UserListSchemaResponse,
  type UpdateUserParams,
  UpdateUserParamsSchema,
  type UpdateUserBody,
  UpdateUserBodySchema
} from '../../../../schemas/users.js';

export default async function (fastify: FastifyInstance) {
  const {
    authenticate,
    rbac,
    usersRepository,
    sessionRepository,
    log,
    httpErrors
  } = fastify;

  /** 用户列表 */
  fastify.get<{ Querystring: UserListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: UserListSchema,
        response: {
          200: SuccessResponseSchema(UserListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const data = await usersRepository.findAll(request.query);
      return reply.success('获取用户列表成功', data);
    }
  );

  /** 更新用户 */
  fastify.put<{ Params: UpdateUserParams; Body: UpdateUserBody }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: UpdateUserParamsSchema,
        body: UpdateUserBodySchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const { name, role, status, avatar } = request.body;

      const existing = await usersRepository.findById(id);
      if (!existing) {
        throw httpErrors.notFound('用户不存在');
      }

      await usersRepository.update(id, { name, role, status, avatar });

      // 同步更新 session 中的角色和状态（失败仅记录日志，不影响主流程）
      if (role !== undefined) {
        try {
          await sessionRepository.refreshUserSessionsRole(id, role);
        } catch (error) {
          log.error({ error }, 'Failed to sync session role');
        }
      }

      if (status !== undefined) {
        try {
          await sessionRepository.refreshUserSessionsStatus(id, status);
        } catch (error) {
          log.error({ error }, 'Failed to sync session status');
        }
      }

      return reply.success('更新用户成功');
    }
  );
}
