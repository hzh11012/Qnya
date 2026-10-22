import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IdSchema, SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  MineCollectionItemSchema,
  MineHistoryItemSchema,
  MineListQuery,
  MineListQuerySchema
} from '../../../../schemas/mine.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, interactionRepository } = fastify;

  /** 我的追番 */
  fastify.get<{ Querystring: MineListQuery }>(
    '/collections',
    {
      preHandler: [authenticate, rbac.requireRoleAtLeast('user')],
      schema: {
        querystring: MineListQuerySchema,
        response: {
          200: SuccessResponseSchema(
            z.object({
              items: z.array(MineCollectionItemSchema),
              total: z.number()
            })
          )
        }
      }
    },
    async (request, reply) => {
      const { page, pageSize } = request.query;
      const result = await interactionRepository.findUserCollections(
        request.sessionData!.userId,
        page,
        pageSize
      );
      return reply.success('获取追番列表成功', result);
    }
  );

  /** 我的历史 */
  fastify.get<{ Querystring: MineListQuery }>(
    '/histories',
    {
      preHandler: [authenticate, rbac.requireRoleAtLeast('user')],
      schema: {
        querystring: MineListQuerySchema,
        response: {
          200: SuccessResponseSchema(
            z.object({
              items: z.array(MineHistoryItemSchema),
              total: z.number()
            })
          )
        }
      }
    },
    async (request, reply) => {
      const { page, pageSize, keyword } = request.query;
      const result = await interactionRepository.findUserHistories(
        request.sessionData!.userId,
        page,
        pageSize,
        keyword || undefined
      );
      return reply.success('获取历史记录成功', result);
    }
  );

  /** 清空全部历史记录 */
  fastify.delete(
    '/histories',
    {
      preHandler: [authenticate, rbac.requireRoleAtLeast('user')],
      schema: {
        response: {
          200: SuccessResponseSchema(z.object({ cleared: z.number() }))
        }
      }
    },
    async (request, reply) => {
      const cleared = await interactionRepository.clearHistories(
        request.sessionData!.userId
      );
      return reply.success(cleared ? '清空成功' : '暂无历史记录', { cleared });
    }
  );

  /** 删除一条历史记录（按动漫，仅限本人） */
  fastify.delete<{ Params: { animeId: string } }>(
    '/histories/:animeId',
    {
      preHandler: [authenticate, rbac.requireRoleAtLeast('user')],
      schema: {
        params: z.object({ animeId: IdSchema }),
        response: {
          200: SuccessResponseSchema(z.object({ deleted: z.boolean() }))
        }
      }
    },
    async (request, reply) => {
      const deleted = await interactionRepository.deleteHistory(
        request.sessionData!.userId,
        request.params.animeId
      );
      return reply.success(deleted ? '删除成功' : '历史记录不存在', {
        deleted
      });
    }
  );
}
