import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import { HomeResponseSchema } from '../../../../schemas/home.js';

export default async function (fastify: FastifyInstance) {
  const { optionalAuthenticate, homeRepository } = fastify;

  /** 首页聚合：我的追番（登录）+ 各类型推荐（adult 需 r18 权限） */
  fastify.get(
    '/',
    {
      preHandler: [optionalAuthenticate],
      schema: {
        response: {
          200: SuccessResponseSchema(HomeResponseSchema)
        }
      }
    },
    async (request, reply) => {
      const userId = request.sessionData?.userId;
      // 未登录：仅返回类型推荐（adult 隐藏）；登录：追加我的追番
      let collections: Awaited<
        ReturnType<typeof homeRepository.findCollections>
      > = [];
      let r18 = false;
      if (userId) {
        r18 = await homeRepository.findR18(userId);
        collections = await homeRepository.findCollections(userId);
      }
      const animeTypes = await homeRepository.findAnimeTypes(r18);
      return reply.success('获取首页数据成功', { collections, animeTypes });
    }
  );
}
