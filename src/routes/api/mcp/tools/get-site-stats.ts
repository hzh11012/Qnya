import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';

export function registerGetSiteStats(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { dashboardRepository } = fastify;

  server.registerTool(
    'get_site_stats',
    {
      description:
        '获取 Qnya 站点概览数据。建议在每次会话开始时调用，了解站点当前状态后再决定下一步操作。' +
        '返回：番剧总数及各状态/类型分布、视频数、用户数、互动数据、追番 Top 10、待处理反馈数。',
      inputSchema: {}
    },
    async () => {
      const d = await dashboardRepository.getStats();

      const summary = {
        content: {
          animeTotal: d.content.animeTotal,
          animeByStatus: d.content.animeByStatus,
          animeByType: d.content.animeByType,
          videoTotal: d.content.videoTotal,
          seriesTotal: d.content.seriesTotal
        },
        users: {
          total: d.users.total,
          active: d.users.active
        },
        interaction: d.interaction,
        pendingFeedbacks: d.pending.feedbacks,
        topCollections: d.topCollections.map(
          (r: { animeId: number; animeName: string; count: number }) => ({
            animeId: r.animeId,
            animeName: r.animeName,
            count: r.count
          })
        )
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }]
      };
    }
  );
}
