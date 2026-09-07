import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import { DashboardStatsSchemaResponse } from '../../../../schemas/dashboard.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, dashboardRepository } = fastify;

  fastify.get(
    '/stats',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        response: { 200: SuccessResponseSchema(DashboardStatsSchemaResponse) }
      }
    },
    async (_request, reply) => {
      const data = await dashboardRepository.getStats();
      return reply.success('获取仪表盘数据成功', data);
    }
  );
}
