import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isUniqueViolation } from '../../../../utils/db-errors.js';

export function registerUpdateTopic(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { topicsRepository, animeRepository } = fastify;

  server.registerTool(
    'update_topic',
    {
      description:
        '修改专题的名称、简介、封面、发布状态，或整体替换收录的番剧列表。id 从 list_topics 返回结果中获取。注意 animeIds 为整体替换：追加番剧时须先把 list_topics 返回的现有 id 列表合并后再传；传空数组会清空收录。',
      inputSchema: {
        id: z.uuid().describe('专题 ID，来自 list_topics 返回的 id 字段'),
        name: z.string().min(1).max(50).optional().describe('新专题名'),
        description: z.string().min(1).optional().describe('新简介'),
        cover: z.string().min(1).max(255).optional().describe('新封面图 URL'),
        status: z
          .boolean()
          .optional()
          .describe('发布状态：true 发布 / false 转为草稿'),
        animeIds: z
          .array(z.uuid())
          .optional()
          .describe(
            '整体替换收录的番剧 ID 列表（来自 list_anime）；追加时先合并现有列表再传，传空数组清空收录'
          )
      }
    },
    async ({ id, name, description, cover, status, animeIds }) => {
      if (
        name === undefined &&
        description === undefined &&
        cover === undefined &&
        status === undefined &&
        animeIds === undefined
      ) {
        return {
          content: [
            {
              type: 'text',
              text: '至少提供 name / description / cover / status / animeIds 中的一个要修改的字段'
            }
          ],
          isError: true
        };
      }

      const topic = await topicsRepository.findById(id);
      if (!topic) {
        return {
          content: [
            {
              type: 'text',
              text: `未找到 ID 为 ${id} 的专题，请先用 list_topics 查询获取正确 ID`
            }
          ],
          isError: true
        };
      }

      if (name !== undefined && name !== topic.name) {
        const duplicate = await topicsRepository.findByName(name);
        if (duplicate && duplicate.id !== id) {
          return {
            content: [
              { type: 'text', text: `专题名「${name}」已存在，不能重名` }
            ],
            isError: true
          };
        }
      }

      let validAnimeIds: string[] | undefined;
      if (animeIds !== undefined) {
        const found = await animeRepository.findSeasonByIds(animeIds);
        const invalid = animeIds.filter(animeId => !found.has(animeId));
        if (invalid.length > 0) {
          return {
            content: [
              {
                type: 'text',
                text: `以下 animeId 不存在：${invalid.join('、')}，请用 list_anime 重新查询`
              }
            ],
            isError: true
          };
        }
        validAnimeIds = animeIds;
      }

      try {
        await topicsRepository.update(id, {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(cover !== undefined && { cover }),
          ...(status !== undefined && { status }),
          ...(validAnimeIds !== undefined && { animeIds: validAnimeIds })
        });
      } catch (error) {
        // 并发竞态兜底：预检查通过后仍可能撞唯一索引
        if (isUniqueViolation(error)) {
          return {
            content: [
              { type: 'text', text: `专题名「${name}」已存在，不能重名` }
            ],
            isError: true
          };
        }
        throw error;
      }

      const changes = [
        name !== undefined && `名称→「${name}」`,
        description !== undefined && '简介→已更新',
        cover !== undefined && '封面→已更新',
        status !== undefined && `状态→${status ? '已发布' : '草稿'}`,
        animeIds !== undefined && `收录番剧→${animeIds.length} 部（整体替换）`
      ].filter(Boolean);

      return {
        content: [
          {
            type: 'text',
            text: `✅ 专题「${topic.name}」已更新（${changes.join('，')}）`
          }
        ]
      };
    }
  );
}
