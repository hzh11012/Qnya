import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export function registerListTorrents(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { qbit } = fastify;

  server.registerTool(
    'list_torrents',
    {
      description:
        '查看 qBittorrent 下载列表及进度。' +
        '可按状态筛选：downloading（下载中）、stalledDL（停滞）、pausedDL（已暂停）、uploading（做种中）、error（出错）。' +
        '返回 torrentHash 可用于关联 list_tasks 中的任务记录。',
      inputSchema: {
        filter: z
          .enum([
            'downloading',
            'stalledDL',
            'pausedDL',
            'uploading',
            'error',
            'completed'
          ])
          .optional()
          .describe('状态筛选，不传则返回全部'),
        limit: z.number().int().min(1).max(50).optional().default(10),
        offset: z.number().int().min(0).optional().default(0)
      }
    },
    async ({ filter, limit, offset }) => {
      const { items, total } = await qbit.getTorrents({
        filter: filter as any,
        limit: limit ?? 10,
        offset: offset ?? 0
      });

      const simplified = items.map(t => ({
        hash: t.hash,
        name: t.name,
        state: t.state,
        progress: `${(t.progress * 100).toFixed(1)}%`,
        sizeMB: Math.round(t.size / 1024 / 1024),
        dlspeedKB: Math.round(t.dlspeed / 1024),
        eta: t.eta === 8640000 ? '∞' : `${Math.round(t.eta / 60)}min`
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
