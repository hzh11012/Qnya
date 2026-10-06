import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  ClientHotQuerySchema,
  ClientHotResponseSchema,
  type ClientHotQuery
} from '../../../../schemas/anime.js';
import { buildSeasonSuffix } from '../../../../utils/season.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, animeRepository } = fastify;

  /** 热门列表：按评分人数排序 */
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
}
