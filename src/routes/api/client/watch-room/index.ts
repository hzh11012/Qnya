import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IdSchema, SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  WatchRoomDetailSchema,
  WatchRoomListQuerySchema,
  WatchRoomListItemSchema,
  WatchRoomMessageQuerySchema,
  WatchRoomMessageSchema,
  WatchRoomStateSchema,
  withRoomErrors,
  type WatchRoomListQuery
} from '../../../../schemas/watch-room.js';
import { replyRoomError, RoomError } from '../../../../utils/watch-room.js';

/**
 * 放映室 HTTP 接口：仅提供查询。
 * 建房 / 加入 / 离开 / 修改 / 踢人 / 播放控制 / 聊天全部走 Socket
 */
export default async function (fastify: FastifyInstance) {
  const { watchRoomService: service } = fastify;

  /** 统一错误处理：RoomError → { code, message, errorCode } */
  const handleRoomError =
    (reply: Parameters<typeof replyRoomError>[0]) => (error: unknown) => {
      if (error instanceof RoomError) return replyRoomError(reply, error);
      throw error;
    };

  /** 登录 + 角色校验 preHandler */
  const authed = [
    fastify.authenticate,
    fastify.rbac.requireRoleAtLeast('user')
  ];

  /** 公开房间列表（放映室大厅；游客可见，按创建时间倒序分页） */
  fastify.get<{ Querystring: WatchRoomListQuery }>(
    '/',
    {
      // filterAdultTypes：正在播放观看者无权访问类型（adult）的房间不在大厅展示
      preHandler: [fastify.authenticate, fastify.rbac.filterAdultTypes()],
      schema: {
        querystring: WatchRoomListQuerySchema,
        response: {
          200: SuccessResponseSchema(
            z.object({
              items: z.array(WatchRoomListItemSchema),
              total: z.number()
            })
          )
        }
      }
    },
    async (request, reply) => {
      const list = await service.listPublicRooms(
        request.query,
        request.excludeTypes
      );
      return reply.success('获取公开房间列表成功', list);
    }
  );

  /** 获取当前用户所在房间（不在任何房间时 data 为 null） */
  fastify.get(
    '/current',
    {
      // filterAdultTypes：房间当前视频是观看者无权访问的类型时不返回视频信息
      preHandler: [...authed, fastify.rbac.filterAdultTypes()],
      schema: {
        response: {
          200: SuccessResponseSchema(WatchRoomStateSchema.nullable())
        }
      }
    },
    async (request, reply) => {
      const state = await service.getCurrentRoom(
        request.sessionData!.userId,
        request.excludeTypes
      );
      return reply.success(
        state ? '获取当前房间成功' : '当前不在任何房间中',
        state
      );
    }
  );

  /** 获取房间详情（私人房间对非成员等同不存在，防泄露） */
  fastify.get<{ Params: { roomId: string } }>(
    '/:roomId',
    {
      // filterAdultTypes：当前视频是观看者无权访问的类型时不返回视频信息
      preHandler: [...authed, fastify.rbac.filterAdultTypes()],
      schema: {
        params: z.object({ roomId: IdSchema }),
        response: withRoomErrors(WatchRoomDetailSchema)
      }
    },
    async (request, reply) => {
      try {
        const detail = await service.getRoomDetail(
          request.params.roomId,
          request.sessionData!.userId,
          request.excludeTypes
        );
        return reply.success('获取房间详情成功', detail);
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );

  /** 聊天与系统通知历史（统一分页，按时间倒序） */
  fastify.get<{
    Params: { roomId: string };
    Querystring: z.infer<typeof WatchRoomMessageQuerySchema>;
  }>(
    '/:roomId/messages',
    {
      preHandler: authed,
      schema: {
        params: z.object({ roomId: IdSchema }),
        querystring: WatchRoomMessageQuerySchema,
        response: withRoomErrors(
          z.object({
            items: z.array(WatchRoomMessageSchema),
            total: z.number()
          })
        )
      }
    },
    async (request, reply) => {
      try {
        const { page, pageSize } = request.query;
        const result = await service.listMessages(
          request.sessionData!.userId,
          request.params.roomId,
          page,
          pageSize
        );
        return reply.success('获取消息历史成功', result);
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );
}
