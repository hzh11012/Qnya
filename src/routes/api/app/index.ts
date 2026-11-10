import type { FastifyInstance } from 'fastify';
import {
  type LatestReleaseQuery,
  LatestReleaseQuerySchema,
  LatestReleaseSchema
} from '../../../schemas/app.js';
import { SuccessResponseSchema } from '../../../schemas/common.js';

/**
 * 移动端/桌面端版本信息（应用内 OTA 自更新）。
 * 数据源：app_releases 表（后台管理端维护），按平台取 versionCode 最大的一条；
 * 该平台无发布记录时返回 null，客户端视为"当前已是最新"。
 */
export default async function (fastify: FastifyInstance) {
  fastify.get<{ Querystring: LatestReleaseQuery }>(
    '/latest',
    {
      schema: {
        querystring: LatestReleaseQuerySchema,
        response: {
          200: SuccessResponseSchema(LatestReleaseSchema.nullable())
        }
      }
    },
    async (request, reply) => {
      const release = await fastify.appReleaseRepository.findLatest(
        request.query.platform
      );
      return reply.success('获取最新版本成功', release);
    }
  );
}
