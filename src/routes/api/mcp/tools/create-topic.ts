import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isUniqueViolation } from '../../../../utils/db-errors.js';

export function registerCreateTopic(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { topicsRepository, animeRepository } = fastify;

  server.registerTool(
    'create_topic',
    {
      description:
        '创建专题推荐页（聚合一批番剧，如「2025 秋季新番导视」「治愈系日常补番清单」）。status 默认 false（草稿，仅管理后台可见），内容确认无误后可传 true 直接发布。',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(50)
          .describe('专题名，如「2025 秋季新番导视」'),
        description: z
          .string()
          .min(1)
          .describe('专题简介，展示在专题页顶部，可写推荐语或编排思路'),
        cover: z
          .string()
          .min(1)
          .max(255)
          .describe('专题封面图 URL，可复用专题内主打番剧的 banner'),
        status: z
          .boolean()
          .optional()
          .default(false)
          .describe('是否发布；默认 false（草稿，仅管理后台可见）'),
        animeIds: z
          .array(z.uuid())
          .optional()
          .default([])
          .describe('收录进专题的番剧 ID 列表，来自 list_anime 返回的 id 字段')
      }
    },
    async ({ name, description, cover, status, animeIds }) => {
      const existing = await topicsRepository.findByName(name);
      if (existing) {
        return {
          content: [
            { type: 'text', text: `专题「${name}」已存在，无需重复创建` }
          ],
          isError: true
        };
      }

      // 校验番剧 ID 均有效，无效时明确指出便于模型纠正
      const ids = animeIds ?? [];
      const found = await animeRepository.findSeasonByIds(ids);
      const invalid = ids.filter(id => !found.has(id));
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

      try {
        const topic = await topicsRepository.create({
          name,
          description,
          cover,
          status,
          animeIds: ids
        });
        return {
          content: [
            {
              type: 'text',
              text: `✅ 专题「${topic.name}」已创建（收录 ${ids.length} 部番剧，${status ? '已发布' : '草稿'}）`
            }
          ]
        };
      } catch (error) {
        // 并发竞态兜底：预检查通过后仍可能撞唯一索引
        if (isUniqueViolation(error)) {
          return {
            content: [
              { type: 'text', text: `专题「${name}」已存在，无需重复创建` }
            ],
            isError: true
          };
        }
        throw error;
      }
    }
  );
}
