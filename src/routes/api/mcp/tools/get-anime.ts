import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export function registerGetAnime(server: McpServer, fastify: FastifyInstance) {
  const { animeRepository } = fastify;

  server.registerTool(
    'get_anime',
    {
      description:
        '根据 ID 获取单条番剧的完整信息，包含 list_anime 精简掉的 description、cover、banner、director、cv 等字段。' +
        'id 从 list_anime 返回结果中获取。注意：返回结果不含 tags，如需 tags 请调用 list_tags。',
      inputSchema: {
        id: z.number().int().describe('番剧 ID，来自 list_anime 返回的 id 字段')
      }
    },
    async ({ id }) => {
      const anime = await animeRepository.findById(id);
      if (!anime) {
        return {
          content: [{ type: 'text', text: `未找到 ID 为 ${id} 的番剧` }],
          isError: true
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(anime, null, 2) }]
      };
    }
  );
}
