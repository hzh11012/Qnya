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
import { highlight } from '../../../../utils/pinyin.js';
import { t2s } from '../../../../utils/t2s.js';

const CJK_RE = /\p{Script=Han}/u;

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

      const isChinese = CJK_RE.test(keyword);

      const data = result.map(a => {
        let highlightName: string;
        if (a.matchedByName) {
          highlightName = highlight(a.name, isChinese ? t2s(keyword) : keyword);
        } else {
          highlightName = `<em class="keyword">${a.name}</em>`;
        }
        return { name: a.name, highlightName };
      });

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

      const isChinese = CJK_RE.test(keyword);

      const items = result.items.map(a => ({
        ...a,
        highlightName: highlight(a.name, isChinese ? t2s(keyword) : keyword)
      }));

      return reply.success('搜索成功', { items, total: result.total });
    }
  );
}
