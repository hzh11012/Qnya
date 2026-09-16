import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export function registerSearchTmdb(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { config } = fastify;

  server.registerTool(
    'search_tmdb',
    {
      description: '在 TMDB 搜索动漫或电影，返回候选列表',
      inputSchema: {
        query: z.string().describe('搜索关键词（动漫名称）'),
        language: z.string().optional().default('zh-CN').describe('语言代码')
      }
    },
    async ({ query, language }) => {
      const url = new URL(`https://${config.TMDB_API_DOMAIN}/3/search/multi`);
      url.searchParams.set('query', query);
      url.searchParams.set('language', language ?? 'zh-CN');
      url.searchParams.set('include_adult', 'true');

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${config.TMDB_API_KEY}`,
          Accept: 'application/json'
        }
      });
      if (!res.ok)
        return {
          content: [{ type: 'text', text: `TMDB 搜索失败: ${res.status}` }],
          isError: true
        };

      const data: any = await res.json();
      const items = (data.results ?? [])
        .filter((i: any) => i.media_type === 'tv' || i.media_type === 'movie')
        .slice(0, 8)
        .map((i: any) => ({
          tmdbId: i.id,
          mediaType: i.media_type,
          name: i.media_type === 'movie' ? i.title : i.name,
          overview: (i.overview ?? '').slice(0, 100)
        }));

      return {
        content: [{ type: 'text', text: JSON.stringify(items, null, 2) }]
      };
    }
  );
}
