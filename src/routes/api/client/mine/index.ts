import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
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
      const { page, pageSize } = request.query;
      const result = await interactionRepository.findUserHistories(
        request.sessionData!.userId,
        page,
        pageSize
      );
      return reply.success('获取历史记录成功', result);
    }
  );
}
