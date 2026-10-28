import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import { McpInfoSchemaResponse } from '../../../../schemas/mcp.js';

const guideContent = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../mcp/skills.md'),
  'utf-8'
);

const TOOLS = [
  {
    name: 'get_site_stats',
    description: '获取站点概览（番剧数、下载数、用户数等）'
  },
  { name: 'search_tmdb', description: '按关键词搜索番剧或电影，返回候选列表' },
  { name: 'get_tmdb_detail', description: '获取 TMDB 详情，TV 支持按季查询' },
  {
    name: 'list_anime',
    description: '查询番剧列表，支持关键词/状态/类型/年份/季度/标签筛选'
  },
  { name: 'get_anime', description: '按 ID 获取单条番剧完整信息' },
  { name: 'list_series', description: '查询系列列表（一个系列含多季）' },
  {
    name: 'list_tags',
    description: '获取所有标签（id + name），入库前必须调用'
  },
  { name: 'create_anime', description: '将番剧入库，系列不存在时自动创建' },
  {
    name: 'update_anime',
    description: '修改已入库番剧的字段，只传需要修改的字段'
  },
  {
    name: 'create_video',
    description: '为已入库番剧添加剧集（播放记录），支持 SP 小数集数'
  },
  {
    name: 'create_topic',
    description: '创建专题推荐页并收录番剧，默认草稿'
  },
  { name: 'add_torrent', description: '向 qBittorrent 添加磁力链接或种子 URL' },
  { name: 'list_torrents', description: '查看 qBittorrent 下载列表和进度' },
  { name: 'list_tasks', description: '查看下载完成后待入库的文件任务' },
  {
    name: 'search_resources',
    description: '从 animes.garden 按关键词搜索磁力资源'
  }
];

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, config } = fastify;

  fastify.get(
    '/info',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        response: { 200: SuccessResponseSchema(McpInfoSchemaResponse) }
      }
    },
    async (_request, reply) => {
      return reply.success('获取 MCP 信息成功', {
        endpoint: '/api/mcp',
        tokenEnabled: !!config.MCP_TOKEN,
        tools: TOOLS,
        guide: guideContent
      });
    }
  );
}
