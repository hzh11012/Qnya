import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const RESOURCE_API = 'https://api.animes.garden/resources';

export function registerSearchResources(server: McpServer) {
  server.registerTool(
    'search_resources',
    {
      description:
        '从 animes.garden 搜索番剧磁力资源，返回 title、magnet、sizeMB、fansub、createdAt。' +
        '搜索结果必须完整展示给用户，由用户选择后才能将 magnet 传给 add_torrent，不得自行选择。',
      inputSchema: {
        keyword: z.string().describe('搜索关键词，建议使用番剧原名或常用译名'),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(50).optional().default(20)
      }
    },
    async ({ keyword, page, pageSize }) => {
      const url = new URL(RESOURCE_API);
      url.searchParams.set('type', '动画');
      url.searchParams.set('search', keyword);
      url.searchParams.set('page', String(page ?? 1));
      url.searchParams.set('pageSize', String(pageSize ?? 20));

      let data: any;
      try {
        const response = await fetch(url.toString(), {
          signal: AbortSignal.timeout(10_000),
          headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok)
          return {
            content: [
              { type: 'text', text: `请求失败: HTTP ${response.status}` }
            ],
            isError: true
          };
        data = await response.json();
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: `网络错误: ${e.message}` }],
          isError: true
        };
      }

      const items = (data.resources ?? []).map((item: any) => ({
        title: item.title,
        magnet: item.magnet,
        sizeMB: item.size ? Math.round(item.size / 1024 / 1024) : null,
        fansub: item.fansub?.name ?? item.publisher?.name ?? null,
        createdAt: item.createdAt
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { items, hasMore: !data.pagination?.complete },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
