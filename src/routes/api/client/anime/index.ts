import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  ClientGuessQuerySchema,
  ClientHotQuerySchema,
  ClientHotResponseSchema,
  type ClientGuessQuery,
  type ClientHotQuery
} from '../../../../schemas/anime.js';
import { buildSeasonSuffix } from '../../../../utils/season.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, animeRepository } = fastify;

  /** 热门列表：按评分人数排序（游客可浏览，adult 按权限过滤） */
  fastify.get<{ Querystring: ClientHotQuery }>(
    '/hot',
    {
      preHandler: [authenticate, rbac.filterAdultTypes()],
      schema: {
        querystring: ClientHotQuerySchema,
        response: {
          200: SuccessResponseSchema(ClientHotResponseSchema)
        }
      }
    },
    async (request, reply) => {
      const { page, pageSize } = request.query;
      const data = await animeRepository.findHot({
        page,
        pageSize,
        excludeTypes: request.excludeTypes
      });

      // 展示文案 = 名称 + 季后缀（与搜索/专题详情一致）；
      // season/seasonName 不在响应 schema 中，序列化时自动剥掉
      const items = data.items.map(a => ({
        ...a,
        name: a.name + buildSeasonSuffix(a.season, a.seasonName)
      }));

      return reply.success('获取热门列表成功', { items, total: data.total });
    }
  );

  /** 猜你喜欢：随机排序分页（seed 便同一会话内分页稳定）；未登录/无权限排除 adult */
  fastify.get<{ Querystring: ClientGuessQuery }>(
    '/guess',
    {
      preHandler: [authenticate, rbac.filterAdultTypes()],
      schema: {
        querystring: ClientGuessQuerySchema,
        response: {
          200: SuccessResponseSchema(ClientHotResponseSchema)
        }
      }
    },
    async (request, reply) => {
      const { page, pageSize, seed } = request.query;
      const data = await animeRepository.findGuess({
        page,
        pageSize,
        seed,
        excludeTypes: request.excludeTypes,
        userId: request.sessionData?.userId ?? null
      });

      // 展示文案 = 名称 + 季后缀（与热门/搜索一致）
      const items = data.items.map(a => ({
        ...a,
        name: a.name + buildSeasonSuffix(a.season, a.seasonName)
      }));

      return reply.success('获取猜你喜欢成功', { items, total: data.total });
    }
  );
}
