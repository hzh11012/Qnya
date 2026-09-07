import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isUniqueViolation } from '../../../../utils/db-errors.js';

export function registerCreateAnime(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { seriesRepository, animeRepository } = fastify;

  server.registerTool(
    'create_anime',
    {
      description:
        '将动漫信息录入 Qnya 数据库。系列不存在时自动创建，入库 status 默认为 draft。',
      inputSchema: {
        seriesName: z.string().describe('系列名称，如《进击的巨人》'),
        name: z.string().describe('本季番剧名称'),
        description: z.string().optional().default('暂无简介'),
        remark: z
          .string()
          .optional()
          .describe(
            '番剧一句话简评，严格不超过15字。风格犀利有趣，可借用当下流行网络梗、二次元黑话或谐音梗，让人看一眼就想点进去。禁止填"暂无"或平铺直叙的剧情描述。'
          ),
        cover: z.string().optional().default('').describe('封面图 URL'),
        banner: z.string().optional().default('').describe('横幅图 URL'),
        status: z
          .enum(['draft', 'upcoming', 'airing', 'completed'])
          .optional()
          .default('draft'),
        type: z.enum(['movie', 'japanese', 'american', 'chinese', 'adult']),
        year: z.number().describe('上映年份'),
        month: z.enum(['january', 'april', 'july', 'october']),
        season: z.number().optional().default(1).describe('季数，默认 1'),
        seasonName: z.string().optional().describe('季名称，可选'),
        director: z.string().optional().default('未知').describe('导演'),
        cv: z.string().optional().default('未知').describe('声优列表'),
        tagIds: z
          .array(z.number())
          .optional()
          .default([])
          .describe('从 list_tags 返回的标签 ID 列表，挑选符合题材的填入')
      }
    },
    async ({
      seriesName,
      name,
      description,
      remark,
      cover,
      banner,
      status,
      type,
      year,
      month,
      season,
      seasonName,
      director,
      cv,
      tagIds
    }) => {
      // 系列不存在则自动创建
      const existingSeries = await seriesRepository.findByName(seriesName);
      let seriesId: number;
      if (existingSeries) {
        seriesId = existingSeries.id;
      } else {
        try {
          const created = await seriesRepository.create({ name: seriesName });
          seriesId = created.id;
        } catch (error) {
          // 兼发竞态兑底：同名系列已被其他请求创建
          if (isUniqueViolation(error)) {
            const series = await seriesRepository.findByName(seriesName);
            if (!series) throw error;
            seriesId = series.id;
          } else {
            throw error;
          }
        }
      }

      const s = season ?? 1;
      const existing = await animeRepository.findBySeriesAndSeason(seriesId, s);
      if (existing) {
        return {
          content: [
            {
              type: 'text',
              text: `《${name}》第 ${s} 季已存在，无需重复入库`
            }
          ],
          isError: true
        };
      }

      try {
        await animeRepository.create({
          seriesId,
          season: s,
          seasonName,
          name,
          description: description ?? '暂无简介',
          remark: (remark ?? '暂无').slice(0, 25),
          cover: cover ?? '',
          banner: banner ?? '',
          status: status ?? 'draft',
          type,
          year,
          month,
          director: director ?? '未知',
          cv: cv ?? '未知',
          tags: tagIds ?? []
        });
      } catch (error) {
        // 兼发竞态兑底：预检查通过后仍可能撞唯一索引
        if (isUniqueViolation(error)) {
          return {
            content: [
              {
                type: 'text',
                text: `《${name}》第 ${s} 季已存在，无需重复入库`
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
            text: `✅ 《${name}》第 ${s} 季已入库，状态: ${status ?? 'draft'}，系列: ${seriesName}`
          }
        ]
      };
    }
  );
}
