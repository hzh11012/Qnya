import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export function registerListSeries(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { seriesRepository } = fastify;

  server.registerTool(
    'list_series',
    {
      description: '查询 Qnya 数据库中已有的系列列表',
      inputSchema: {
        keyword: z.string().optional().describe('关键词筛选'),
        page: z.number().optional().default(1),
        pageSize: z.number().optional().default(20)
      }
    },
    async ({ keyword, page, pageSize }) => {
      const data = await seriesRepository.findAll({
        keyword,
        page: page ?? 1,
        pageSize: pageSize ?? 20,
        sort: 'createdAt',
        order: 'desc'
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      };
    }
  );
}
