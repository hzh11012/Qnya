import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  SearchSuggestQuerySchema,
  SearchSuggestResponseSchema,
  type SearchSuggestQuery,
  SearchListQuerySchema,
  SearchListResponseSchema,
  type SearchListQuery
} from '../../../../schemas/search.js';
import { highlight, highlightByPinyin } from '../../../../utils/pinyin.js';
import { t2s } from '../../../../utils/t2s.js';

const CJK_RE = /\p{Script=Han}/u;

/**
 * 生成高亮名称：
 * - 命中名称（含繁体归一化）时高亮关键词
 * - 命中拼音/首字母时，反查命中的汉字并局部高亮
 * - 无法精确映射时兑底整名包裹，保证前端始终有高亮可展示
 */
const buildHighlight = (
  name: string,
  keyword: string,
  matchedByName: boolean
) => {
  if (matchedByName) {
    return highlight(name, CJK_RE.test(keyword) ? t2s(keyword) : keyword);
  }
  // match 失败时内部已兑底整名包裹
  return highlightByPinyin(name, keyword);
};

export default async function (fastify: FastifyInstance) {
  const { animeRepository, authenticate, rbac } = fastify;

  fastify.get<{ Querystring: SearchSuggestQuery }>(
    '/suggestions',
    {
      preHandler: [authenticate, rbac.filterAdultTypes()],
      schema: {
        querystring: SearchSuggestQuerySchema,
        response: {
          200: SuccessResponseSchema(SearchSuggestResponseSchema)
        }
      }
    },
    async (request, reply) => {
      const { keyword } = request.query;
      const excludeTypes = request.excludeTypes;

      const result = await animeRepository.findByNameLike(
        keyword,
        excludeTypes
      );

      const data = result.map(a => ({
        name: a.name,
        highlightName: buildHighlight(a.name, keyword, a.matchedByName)
      }));

      return reply.success('获取搜索建议成功', data);
    }
  );

  fastify.get<{ Querystring: SearchListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.filterAdultTypes()],
      schema: {
        querystring: SearchListQuerySchema,
        response: {
          200: SuccessResponseSchema(SearchListResponseSchema)
        }
      }
    },
    async (request, reply) => {
      const { keyword, page, pageSize } = request.query;
      const excludeTypes = request.excludeTypes;

      const result = await animeRepository.search(
        keyword,
        page,
        pageSize,
        excludeTypes
      );

      const items = result.items.map(a => {
        const { matchedByName, ...rest } = a;
        return {
          ...rest,
          highlightName: buildHighlight(a.name, keyword, matchedByName)
        };
      });

      return reply.success('搜索成功', { items, total: result.total });
    }
  );
}
