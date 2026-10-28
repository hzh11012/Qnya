import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isUniqueViolation } from '../../../../utils/db-errors.js';

export function registerCreateVideo(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { animeRepository, videosRepository } = fastify;

  server.registerTool(
    'create_video',
    {
      description:
        '为已入库的番剧添加剧集（播放记录）。episode 为 0.5 网格：正片用整数（1、2、3），SP/总集篇用 6.5、12.5 这类小数占位，0 为合法先导集。同一番剧下集数不可重复。',
      inputSchema: {
        animeId: z.uuid().describe('番剧 ID，来自 list_anime 返回的 id 字段'),
        title: z
          .string()
          .min(1)
          .max(100)
          .describe('剧集标题，如「第6.5话 OVA」或集数同名标题'),
        episode: z
          .number()
          .min(0)
          .multipleOf(0.5)
          .describe(
            '集数编号：非负且为 0.5 的整数倍。正片整数（1、2…），SP/总集篇小数（6.5、12.5），0 为先导集'
          ),
        url: z
          .string()
          .min(1)
          .max(255)
          .describe('播放地址（站内静态资源路径或外链）')
      }
    },
    async ({ animeId, title, episode, url }) => {
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

      const existing = await videosRepository.findByAnimeIdAndEpisode(
        animeId,
        episode
      );
      if (existing) {
        return {
          content: [
            {
              type: 'text',
              text: `《${anime.name}》第 ${episode} 话已存在（${existing.title}），无需重复添加`
            }
          ],
          isError: true
        };
      }

      try {
        await videosRepository.create({ animeId, title, episode, url });
      } catch (error) {
        // 并发竞态兜底：预检查通过后仍可能撞唯一索引
        if (isUniqueViolation(error)) {
          return {
            content: [
              {
                type: 'text',
                text: `《${anime.name}》第 ${episode} 话已存在，无需重复添加`
              }
            ],
            isError: true
          };
        }
        throw error;
      }

      return {
        content: [
          {
            type: 'text',
            text: `✅ 《${anime.name}》第 ${episode} 话「${title}」已添加`
          }
        ]
      };
    }
  );
}
