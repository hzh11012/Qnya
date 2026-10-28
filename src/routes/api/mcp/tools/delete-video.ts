import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export function registerDeleteVideo(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { animeRepository, videosRepository } = fastify;

  server.registerTool(
    'delete_video',
    {
      description:
        '删除剧集记录（不影响已下载的文件实体）。id 从 list_videos 返回结果中获取。危险操作：必须先向用户确认，征得同意后才能携带 confirm: true 调用。',
      inputSchema: {
        id: z.uuid().describe('剧集 ID，来自 list_videos 返回的 id 字段'),
        confirm: z
          .boolean()
          .describe('安全确认位：向用户确认后必须传 true 才会执行删除')
      }
    },
    async ({ id, confirm }) => {
      if (!confirm) {
        return {
          content: [
            {
              type: 'text',
              text: '已取消：未获用户确认（confirm: true）不会执行删除'
            }
          ],
          isError: true
        };
      }

      const video = await videosRepository.findById(id);
      if (!video) {
        return {
          content: [
            {
              type: 'text',
              text: `未找到 ID 为 ${id} 的剧集，请先用 list_videos 查询获取正确 ID`
            }
          ],
          isError: true
        };
      }

      const anime = await animeRepository.findById(video.animeId);
      const deleted = await videosRepository.deleteById(id);
      if (!deleted) {
        return {
          content: [{ type: 'text', text: '删除失败，剧集可能已被删除' }],
          isError: true
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `🗑️ 已删除${anime ? `《${anime.name}》` : ''}第 ${video.episode} 话「${video.title}」`
          }
        ]
      };
    }
  );
}
