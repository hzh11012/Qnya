import type { FastifyInstance } from 'fastify';
import {
  ResourcesListSchema,
  ResourcesListSchemaResponse,
  type ResourcesListQuery
} from '../../../../schemas/resources.js';
import { SuccessResponseSchema } from '../../../../schemas/common.js';

const resourceUrl = 'https://api.animes.garden/resources';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, httpErrors } = fastify;

  /** 资源列表 */
  fastify.get<{ Querystring: ResourcesListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: ResourcesListSchema,
        response: {
          200: SuccessResponseSchema(ResourcesListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const { page, pageSize, keyword } = request.query;

      // 构造请求URL
      const url = new URL(resourceUrl);
      url.searchParams.set('type', '动画');
      url.searchParams.set('page', page.toString());
      url.searchParams.set('pageSize', pageSize.toString());
      if (keyword) {
        url.searchParams.set('search', keyword);
      }

      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          signal: AbortSignal.timeout(30_000),
          headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
          throw httpErrors.badGateway(`资源站返回异常状态: ${response.status}`);
        }

        let data: any;
        try {
          data = await response.json();
        } catch {
          throw httpErrors.badGateway('资源站响应格式异常,请稍后重试');
        }

        const list = data.resources?.map((item: any) => {
          return {
            title: item.title,
            magnet: item.magnet,
            size: item.size,
            fansub: item.fansub?.name || item.publisher?.name,
            createdAt: item.createdAt
          };
        });

        const res = {
          items: list,
          hasMore: !data.pagination.complete
        };

        return reply.success('资源查询成功', res);
      } catch (error) {
        // 已是带状态码的 http 错误(badGateway 等)直接透传
        if (error && typeof error === 'object' && 'statusCode' in error) {
          throw error;
        }
        // fetch 超时(AbortSignal.timeout 抛出 TimeoutError)
        if (
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
        ) {
          throw httpErrors.gatewayTimeout('资源站响应超时,请稍后重试');
        }
        // DNS 解析失败、连接拒绝等网络错误
        throw httpErrors.badGateway('无法连接资源站,请稍后重试');
      }
    }
  );
}
