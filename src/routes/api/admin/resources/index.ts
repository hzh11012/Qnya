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

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw httpErrors.internalServerError('服务器错误');
      }

      const data: any = await response.json();

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
    }
  );
}
