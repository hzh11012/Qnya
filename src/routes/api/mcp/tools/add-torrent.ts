import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export function registerAddTorrent(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { qbit } = fastify;

  server.registerTool(
    'add_torrent',
    {
      description:
        '向 qBittorrent 添加磁力链接或种子文件 URL，开始下载。' +
        '成功后返回 torrentHash，可用于 list_torrents 监控进度。' +
        '下载完成后 webhook 会自动生成待入库任务，可通过 list_tasks 查看。',
      inputSchema: {
        uri: z
          .string()
          .describe('磁力链接（magnet:?xt=...）或种子文件的 HTTP URL')
      }
    },
    async ({ uri }) => {
      const result = await qbit.addTorrent(uri);
      if (result !== 'Ok.') {
        return {
          content: [
            { type: 'text', text: '添加种子失败，请检查种子链接是否有效' }
          ],
          isError: true
        };
      }

      // 计算 hash 供后续 list_torrents 使用
      try {
        const hash = await qbit.getInfoHash(uri);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  torrentHash: hash,
                  message: '已添加到下载队列'
                },
                null,
                2
              )
            }
          ]
        };
      } catch (e: any) {
        return {
          content: [
            {
              type: 'text',
              text: `已添加到下载队列，但获取 hash 失败: ${e.message}。请通过 list_torrents 查找。`
            }
          ]
        };
      }
    }
  );
}
