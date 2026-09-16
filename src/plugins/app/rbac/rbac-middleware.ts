import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { AnimeType } from '../../../db/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    excludeTypes: AnimeType[] | undefined;
  }

  interface FastifyInstance {
    rbac: ReturnType<typeof createRbacMiddleware>;
  }
}

const ADULT_ALLOWED_ROLES = ['admin', 'premium'];

const createRbacMiddleware = () => {
  /** 前置校验：必须先经过 authenticate，避免非空断言崩溃成 500 */
  const requireSession = (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.sessionData) {
      reply.unauthorized('未登录');
      return false;
    }
    return true;
  };

  return {
    requireAnyRole(...roleCodes: string[]) {
      return async (request: FastifyRequest, reply: FastifyReply) => {
        if (!requireSession(request, reply)) return reply;
        const role = request.sessionData!.role;
        if (!roleCodes.includes(role)) {
          return reply.forbidden('权限不足');
        }
      };
    },

    filterAdultTypes() {
      return async (request: FastifyRequest, reply: FastifyReply) => {
        if (!requireSession(request, reply)) return reply;
        request.excludeTypes = ADULT_ALLOWED_ROLES.includes(
          request.sessionData!.role
        )
          ? undefined
          : (['adult'] as AnimeType[]);
      };
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const rbac = createRbacMiddleware();
    fastify.decorate('rbac', rbac);
  },
  {
    name: 'rbac-middleware',
    dependencies: ['auth-middleware']
  }
);
