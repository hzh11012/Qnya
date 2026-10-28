import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isUniqueViolation } from '../../../../utils/db-errors.js';

export function registerUpdateVideo(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { videosRepository } = fastify;

  server.registerTool(
    'update_video',
    {
      description:
        '修改剧集的标题、集数编号或播放地址，只传需要修改的字段。id 从 list_videos 返回结果中获取。改集数编号同样限定非负且 0.5 的整数倍，同番剧下不可与现有集数重复。',
      inputSchema: {
        id: z.uuid().describe('剧集 ID，来自 list_videos 返回的 id 字段'),
        title: z.string().min(1).max(100).optional().describe('新标题'),
        episode: z
          .number()
          .min(0)
          .multipleOf(0.5)
          .optional()
          .describe('新集数编号：非负且为 0.5 的整数倍'),
        url: z.string().min(1).max(255).optional().describe('新播放地址')
      }
    },
    async ({ id, title, episode, url }) => {
      if (title === undefined && episode === undefined && url === undefined) {
        return {
          content: [
            {
              type: 'text',
              text: '至少提供 title / episode / url 中的一个要修改的字段'
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

      if (episode !== undefined && episode !== video.episode) {
        const existing = await videosRepository.findByAnimeIdAndEpisode(
          video.animeId,
          episode
        );
        if (existing && existing.id !== id) {
          return {
            content: [
              {
                type: 'text',
                text: `该番剧第 ${episode} 话已存在（${existing.title}），不能重复编号`
              }
            ],
            isError: true
          };
        }
      }

      try {
        await videosRepository.update(id, {
          ...(title !== undefined && { title }),
          ...(episode !== undefined && { episode }),
          ...(url !== undefined && { url })
        });
      } catch (error) {
        // 并发竞态兜底：预检查通过后仍可能撞唯一索引
        if (isUniqueViolation(error)) {
          return {
            content: [
              {
                type: 'text',
                text: `该番剧第 ${episode} 话已存在，不能重复编号`
              }
            ],
            isError: true
          };
        }
        throw error;
      }

      const changes = [
        title !== undefined && `标题→「${title}」`,
        episode !== undefined && `集数→${episode}`,
        url !== undefined && `播放地址→已更新`
      ].filter(Boolean);

      return {
        content: [
          {
            type: 'text',
            text: `✅ 剧集已更新（${changes.join('，')}）`
          }
        ]
      };
    }
  );
}
