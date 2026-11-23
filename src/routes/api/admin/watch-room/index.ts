import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IdSchema, SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  AdminWatchRoomBanSchema,
  AdminWatchRoomListItemSchema,
  AdminWatchRoomListQuerySchema,
  AdminWatchRoomMemberSchema,
  AdminWatchRoomMessageQuerySchema,
  AdminWatchRoomUpdateSchema,
  WatchRoomMessageSchema,
  withRoomErrors,
  type AdminWatchRoomListQuery,
  type AdminWatchRoomMessageQuery,
  type WatchRoomUpdateInput
} from '../../../../schemas/watch-room.js';
import { replyRoomError, RoomError } from '../../../../utils/watch-room.js';

export default async function (fastify: FastifyInstance) {
  const { watchRoomService: service } = fastify;

  /** 统一错误处理：RoomError → { code, message, errorCode } */
  const handleRoomError =
    (reply: Parameters<typeof replyRoomError>[0]) => (error: unknown) => {
      if (error instanceof RoomError) return replyRoomError(reply, error);
      throw error;
    };

  /** 管理员 preHandler */
  const adminOnly = [
    fastify.authenticate,
    fastify.rbac.requireAnyRole('admin')
  ];

  /**
   * 房间列表（管理端：含私人房间，
   * 支持可见性筛选与房名/房主昵称搜索）
   */
  fastify.get<{ Querystring: AdminWatchRoomListQuery }>(
    '/',
    {
      preHandler: adminOnly,
      schema: {
        querystring: AdminWatchRoomListQuerySchema,
        response: {
          200: SuccessResponseSchema(
            z.object({
              items: z.array(AdminWatchRoomListItemSchema),
              total: z.number()
            })
          )
        }
      }
    },
    async (request, reply) => {
      const list = await service.adminListRooms(request.query);
      return reply.success('获取房间列表成功', list);
    }
  );

  /** 房间成员（只读：单会话模型下在房成员即在线成员） */
  fastify.get<{ Params: { roomId: string } }>(
    '/:roomId/members',
    {
      preHandler: adminOnly,
      schema: {
        params: z.object({ roomId: IdSchema }),
        response: withRoomErrors(
          z.object({
            items: z.array(AdminWatchRoomMemberSchema),
            total: z.number()
          })
        )
      }
    },
    async (request, reply) => {
      const list = await service.adminListMembers(request.params.roomId);
      return reply.success('获取房间成员成功', list);
    }
  );

  /** 黑名单（被房主移出、当前无法再加入该房间的用户） */
  fastify.get<{ Params: { roomId: string } }>(
    '/:roomId/bans',
    {
      preHandler: adminOnly,
      schema: {
        params: z.object({ roomId: IdSchema }),
        response: withRoomErrors(
          z.object({
            items: z.array(AdminWatchRoomBanSchema),
            total: z.number()
          })
        )
      }
    },
    async (request, reply) => {
      const list = await service.adminListBans(request.params.roomId);
      return reply.success('获取黑名单成功', list);
    }
  );

  /** 解除拉黑（幂等：不在黑名单中同样返回成功） */
  fastify.delete<{ Params: { roomId: string; userId: string } }>(
    '/:roomId/bans/:userId',
    {
      preHandler: adminOnly,
      schema: {
        params: z.object({ roomId: IdSchema, userId: IdSchema }),
        response: withRoomErrors(
          z.object({ roomId: IdSchema, userId: IdSchema })
        )
      }
    },
    async (request, reply) => {
      try {
        const result = await service.adminUnban(
          request.sessionData!.userId,
          request.params.roomId,
          request.params.userId
        );
        return reply.success('已解除该用户的拉黑', result);
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );

  /**
   * 消息记录（聊天 + 系统通知；可按 type 筛选）。
   * 房间解散即连同消息硬删除，所以这里只覆盖「还在进行的房间」
   */
  fastify.get<{
    Params: { roomId: string };
    Querystring: AdminWatchRoomMessageQuery;
  }>(
    '/:roomId/messages',
    {
      preHandler: adminOnly,
      schema: {
        params: z.object({ roomId: IdSchema }),
        querystring: AdminWatchRoomMessageQuerySchema,
        response: withRoomErrors(
          z.object({
            items: z.array(WatchRoomMessageSchema),
            total: z.number()
          })
        )
      }
    },
    async (request, reply) => {
      const list = await service.adminListMessages(
        request.params.roomId,
        request.query
      );
      return reply.success('获取消息记录成功', list);
    }
  );

  /** 编辑房间信息（名称/公告；开放中房间实时广播给成员） */
  fastify.patch<{
    Params: { roomId: string };
    Body: WatchRoomUpdateInput;
  }>(
    '/:roomId',
    {
      preHandler: adminOnly,
      schema: {
        params: z.object({ roomId: IdSchema }),
        body: AdminWatchRoomUpdateSchema,
        response: withRoomErrors(AdminWatchRoomListItemSchema)
      }
    },
    async (request, reply) => {
      try {
        await service.adminUpdateRoom(
          request.sessionData!.userId,
          request.params.roomId,
          request.body
        );
        const item = await service.adminGetRoom(request.params.roomId);
        return reply.success('房间信息已更新', item);
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );

  /** 删除房间（硬删除；开放中房间先广播解散让成员客户端退出） */
  fastify.delete<{ Params: { roomId: string } }>(
    '/:roomId',
    {
      preHandler: adminOnly,
      schema: {
        params: z.object({ roomId: IdSchema }),
        response: withRoomErrors(z.object({ roomId: IdSchema }))
      }
    },
    async (request, reply) => {
      try {
        await service.adminDeleteRoom(
          request.sessionData!.userId,
          request.params.roomId
        );
        return reply.success('房间已删除', { roomId: request.params.roomId });
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );
}
