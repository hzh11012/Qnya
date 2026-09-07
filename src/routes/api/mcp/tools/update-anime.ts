import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export function registerUpdateAnime(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { animeRepository } = fastify;

  server.registerTool(
    'update_anime',
    {
      description:
        '修改已入库番剧的信息。id 从 list_anime 返回结果中获取。所有字段均为可选，只传需要修改的字段即可。',
      inputSchema: {
        id: z
          .number()
          .int()
          .describe('番剧 ID，来自 list_anime 返回的 id 字段'),
        name: z.string().optional().describe('番剧名称'),
        description: z.string().optional().describe('番剧简介'),
        remark: z.string().optional().describe('番剧一句话简评，不超过25字'),
        cover: z.string().optional().describe('封面图 URL'),
        banner: z.string().optional().describe('横幅图 URL'),
        status: z
          .enum(['draft', 'upcoming', 'airing', 'completed'])
          .optional()
          .describe('番剧状态'),
        type: z
          .enum(['movie', 'japanese', 'american', 'chinese', 'adult'])
          .optional()
          .describe('番剧类型'),
        year: z.number().int().min(1990).optional().describe('上映年份'),
        month: z
          .enum(['january', 'april', 'july', 'october'])
          .optional()
          .describe('季度'),
        director: z.string().optional().describe('导演'),
        cv: z.string().optional().describe('声优列表'),
        tagIds: z
          .array(z.number().int())
          .optional()
          .describe('标签 ID 列表，传入后会覆盖原有标签，从 list_tags 获取')
      }
    },
    async ({
      id,
      name,
      description,
      remark,
      cover,
      banner,
      status,
      type,
      year,
      month,
      director,
      cv,
      tagIds
    }) => {
      await animeRepository.update(id, {
        name,
        description,
        remark,
        cover,
        banner,
        status,
        type,
        year,
        month,
        director,
        cv,
        tags: tagIds
      });

      return {
        content: [{ type: 'text', text: `✅ 番剧 ID ${id} 已更新` }]
      };
    }
  );
}
