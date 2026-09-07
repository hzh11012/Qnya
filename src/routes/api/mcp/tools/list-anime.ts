import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export function registerListAnime(server: McpServer, fastify: FastifyInstance) {
  const { animeRepository } = fastify;

  server.registerTool(
    'list_anime',
    {
      description:
        '查询 Qnya 数据库中已有的动漫列表。' +
        '返回字段：id、name、season、seasonName、status、type、year、month、seriesId、avgScore。' +
        '入库前可用此工具确认番剧是否已存在；update_anime 需要此处返回的 id。',
      inputSchema: {
        keyword: z.string().optional().describe('名称关键词筛选'),
        status: z
          .array(z.enum(['draft', 'upcoming', 'airing', 'completed']))
          .optional()
          .describe('状态筛选，可多选'),
        types: z
          .array(z.enum(['movie', 'japanese', 'american', 'chinese', 'adult']))
          .optional()
          .describe('类型筛选，可多选'),
        years: z
          .array(z.number().int().min(1990))
          .optional()
          .describe('年份筛选，可多选，如 [2024, 2025]'),
        months: z
          .array(z.enum(['january', 'april', 'july', 'october']))
          .optional()
          .describe('季度筛选，可多选'),
        tagIds: z
          .array(z.number().int())
          .optional()
          .describe('标签 ID 筛选，同时满足所有传入标签'),
        page: z.number().optional().default(1),
        pageSize: z.number().optional().default(20)
      }
    },
    async ({
      keyword,
      status,
      types,
      years,
      months,
      tagIds,
      page,
      pageSize
    }) => {
      const { items, total } = await animeRepository.findAll({
        keyword,
        status,
        types,
        years,
        months,
        tags: tagIds,
        page: page ?? 1,
        pageSize: pageSize ?? 20,
        sort: 'createdAt',
        order: 'desc'
      });

      const simplified = items.map(item => ({
        id: item.id,
        seriesId: item.seriesId,
        name: item.name,
        season: item.season,
        seasonName: item.seasonName,
        status: item.status,
        type: item.type,
        year: item.year,
        month: item.month,
        avgScore: item.avgScore
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ items: simplified, total }, null, 2)
          }
        ]
      };
    }
  );
}
