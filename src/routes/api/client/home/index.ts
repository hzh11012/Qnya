import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import { HomeResponseSchema } from '../../../../schemas/home.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, homeRepository } = fastify;

  /** 首页聚合：我的追番 + 各类型推荐（adult 仅高级会员/管理员可见；前台需登录） */
  fastify.get(
    '/',
    {
      preHandler: [authenticate, rbac.filterAdultTypes()],
      schema: {
        response: {
          200: SuccessResponseSchema(HomeResponseSchema)
        }
      }
    },
    async (request, reply) => {
      const { userId, role } = request.sessionData!;
      // adult 类型仅对高级会员/管理员可见（与 rbac 中间件保持一致）
      const isPrivileged = role === 'admin' || role === 'premium';
      const collections = await homeRepository.findCollections(userId);
      const animeTypes = await homeRepository.findAnimeTypes(isPrivileged);
      return reply.success('获取首页数据成功', { collections, animeTypes });
    }
  );
}
