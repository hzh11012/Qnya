import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export function registerListVideos(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { animeRepository, videosRepository } = fastify;

  server.registerTool(
    'list_videos',
    {
      description:
        '查看番剧下的全部剧集（按集数升序），含 id、标题、集数编号、播放地址、播放量。添加剧集前用它查漏，修正剧集时用它获取 id。',
      inputSchema: {
        animeId: z.uuid().describe('番剧 ID，来自 list_anime 返回的 id 字段')
      }
    },
    async ({ animeId }) => {
      const anime = await animeRepository.findById(animeId);
      if (!anime) {
        return {
          content: [
            {
              type: 'text',
              text: `未找到 ID 为 ${animeId} 的番剧，请先用 list_anime 查询获取正确 ID`
            }
          ],
          isError: true
        };
      }

      const videos = await videosRepository.findAllByAnimeId(animeId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                anime: anime.name,
                total: videos.length,
                videos
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
