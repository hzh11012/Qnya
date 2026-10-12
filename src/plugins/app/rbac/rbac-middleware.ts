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
const ADULT_EXCLUDED = ['adult'] as AnimeType[];

/** 角色等级：数值越大权限越高（游客身份最低，需登录接口要求 user 及以上） */
const ROLE_LEVEL: Record<string, number> = {
  guest: 0,
  user: 1,
  premium: 2,
  admin: 3
};

const createRbacMiddleware = () => {
  /** 前置校验：必须先经过 authenticate，避免非空断言崩溃成 500 */
  const requireSession = (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.sessionData) {
      reply.unauthorized('未登录');
      return false;
    }
    return true;
  };

  /**
   * adult 内容访问权限：由角色决定（高级会员/管理员），角色不满足时统一过滤
   */
  const canAccessAdult = (role: string) => ADULT_ALLOWED_ROLES.includes(role);

  return {
    /**
     * 要求角色等级不低于指定角色（未登录 → 401；等级不足 → 403）
     * 替代 authenticate 使用，让“需要什么身份”在接口层显式化
     */
    requireRoleAtLeast(roleCode: string) {
      return async (request: FastifyRequest, reply: FastifyReply) => {
        if (!requireSession(request, reply)) return reply;
        const role = request.sessionData!.role;
        // 未知角色要求（roleCode 拼写错误等）一律拒绝，避免误放行
        if ((ROLE_LEVEL[role] ?? -1) < (ROLE_LEVEL[roleCode] ?? 99)) {
          return reply.forbidden('权限不足');
        }
      };
    },

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
        const allowed = canAccessAdult(request.sessionData!.role);
        request.excludeTypes = allowed ? undefined : ADULT_EXCLUDED;
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
