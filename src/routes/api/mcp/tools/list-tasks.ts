import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export function registerListTasks(server: McpServer, fastify: FastifyInstance) {
  const { tasksRepository } = fastify;

  server.registerTool(
    'list_tasks',
    {
      description:
        '查看下载完成后待入库的文件任务列表。' +
        '下载完成时 webhook 自动创建 pending 任务，入库后变为 completed。' +
        '返回字段包含 id（入库时需要）、filename、filePath、fileSize、torrentHash、status。',
      inputSchema: {
        status: z
          .array(z.enum(['pending', 'completed']))
          .optional()
          .describe('状态筛选，不传返回全部；通常只关注 pending'),
        keyword: z.string().optional().describe('文件名关键词筛选'),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(50).optional().default(20)
      }
    },
    async ({ status, keyword, page, pageSize }) => {
      const { items, total } = await tasksRepository.findAll({
        status,
        keyword,
        page: page ?? 1,
        pageSize: pageSize ?? 20,
        sort: 'createdAt',
        order: 'desc'
      });

      const simplified = items.map(t => ({
        id: t.id,
        filename: t.filename,
        filePath: t.filePath,
        sizeMB: Math.round(t.fileSize / 1024 / 1024),
        torrentHash: t.torrentHash,
        status: t.status,
        createdAt: t.createdAt
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
