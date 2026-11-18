import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IdSchema, SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  AdminWatchRoomListItemSchema,
  AdminWatchRoomListQuerySchema,
  AdminWatchRoomUpdateSchema,
  withRoomErrors,
  type AdminWatchRoomListQuery,
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
   * 房间列表（管理端：含私人/已关闭房间，
   * 支持状态/可见性筛选与房名/房主昵称搜索）
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
