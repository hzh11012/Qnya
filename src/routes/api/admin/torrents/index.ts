import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  type AddTorrentBody,
  AddTorrentSchema,
  type TorrentListQuery,
  TorrentListSchema,
  TorrentListSchemaResponse
} from '../../../../schemas/torrents.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, qbit, httpErrors } = fastify;

  /** 添加种子 */
  fastify.post<{ Body: AddTorrentBody }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        body: AddTorrentSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { torrentUrl } = request.body;

      // 添加种子到 qBittorrent；fetch 失败会抛出异常，由全局错误处理转为 500
      const result = await qbit.addTorrent(torrentUrl);
      if (result !== 'Ok.') {
        throw httpErrors.badRequest('添加种子失败，请检查种子链接是否有效');
      }

      return reply.success('添加种子成功');
    }
  );

  /** 资源列表 */
  fastify.get<{ Querystring: TorrentListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: TorrentListSchema,
        response: {
          200: SuccessResponseSchema(TorrentListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const { page, pageSize, status, sort, order } = request.query;

      const { items, total } = await qbit.getTorrents({
        sort,
        filter: status,
        reverse: order === 'desc',
        limit: pageSize,
        offset: (page - 1) * pageSize
      });

      const res = items.map(item => {
        const { name, state, progress, size, added_on } = item;
        return {
          name,
          status: state,
          progress,
          size,
          createdAt: new Date(added_on * 1000)
        };
      });

      return reply.success('获取种子列表成功', {
        items: res,
        total
      });
    }
  );
}
