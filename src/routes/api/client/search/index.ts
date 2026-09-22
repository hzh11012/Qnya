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
import { highlightByPinyin, escapeHtml } from '../../../../utils/pinyin.js';
import { t2s } from '../../../../utils/t2s.js';
import { buildSeasonSuffix } from '../../../../utils/season.js';

interface SeasonInfo {
  season: number;
  seasonName: string | null;
}

/**
 * 生成高亮名称（展示文案 = 名称 + 季后缀）：
 * - 名称字面命中（含繁简归一化）：只高亮名称中命中的部分
 * - 拼音/首字母/季名命中：反查命中的字符并局部高亮
 *   （如搜「anying」高亮季名中的「暗影」，而非整名包裹）
 * - 未命中展示文案（命中声优/简介等字段时）：不高亮，返回纯文本
 */
const buildHighlight = (
  name: string,
  season: SeasonInfo | undefined,
  keyword: string
) => {
  // 展示文案与季后缀格式保持一致（季名优先，其次第N季，第一季不拼）
  const display =
    name + (season ? buildSeasonSuffix(season.season, season.seasonName) : '');
  // match 同时兼容字面与拼音匹配，繁体关键词先归一化
  const highlighted = highlightByPinyin(display, t2s(keyword));
  return highlighted ?? escapeHtml(display);
};

export default async function (fastify: FastifyInstance) {
  const { animeSearch, authenticate, rbac } = fastify;

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

      const result = await animeSearch.suggest(keyword, excludeTypes);

      // 索引中不含季字段，按 id 回表水合（≤10 条，代价可忽略）
      const seasonMap = await fastify.animeRepository.findSeasonByIds(
        result.map(a => a.id)
      );

      const data = result.map(a => {
        const info = seasonMap.get(a.id);
        return {
          // id 用于前端作为 React key：同名番剧（同系列多季）存在，
          // 用 name 作 key 会产生重复 key，列表更新时 DOM 错乱
          id: a.id,
          name: a.name,
          highlightName: buildHighlight(a.name, info, keyword)
        };
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

      const result = await animeSearch.search(
        keyword,
        page,
        pageSize,
        excludeTypes
      );

      const items = result.items.map(a => {
        const { season, seasonName, ...rest } = a;
        return {
          ...rest,
          highlightName: buildHighlight(
            rest.name,
            { season, seasonName },
            keyword
          )
        };
      });

      return reply.success('搜索成功', { items, total: result.total });
    }
  );
}
