import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TopicListQuery } from '../../../../schemas/topics.js';

export function registerListTopics(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { topicsRepository } = fastify;

  server.registerTool(
    'list_topics',
    {
      description:
        '查询专题列表（按创建时间倒序），含 id、名称、简介、发布状态、封面和收录的番剧。创建专题前用它查重名，编辑专题时用它获取 id 和当前收录列表。',
      inputSchema: {
        keyword: z.string().optional().describe('按专题名筛选关键词'),
        status: z
          .boolean()
          .optional()
          .describe('按发布状态筛选：true 已发布 / false 草稿，不传返回全部'),
        page: z.number().int().min(1).optional().default(1).describe('页码'),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(20)
          .describe('每页数量，默认 20')
      }
    },
    async ({ keyword, status, page, pageSize }) => {
      const query: TopicListQuery = {
        page: page ?? 1,
        pageSize: pageSize ?? 20,
        sort: 'createdAt',
        order: 'desc',
        keyword,
        status: status === undefined ? undefined : [status]
      };

      const { items, total } = await topicsRepository.findAll(query);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ total, items }, null, 2)
          }
        ]
      };
    }
  );
}
