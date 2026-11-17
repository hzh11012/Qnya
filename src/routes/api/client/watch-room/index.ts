import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IdSchema, SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  WatchRoomCreateSchema,
  WatchRoomDetailSchema,
  WatchRoomInviteSchema,
  WatchRoomInviteSchemaResponse,
  WatchRoomJoinSchema,
  WatchRoomKickSchema,
  WatchRoomListQuerySchema,
  WatchRoomListItemSchema,
  WatchRoomMessageQuerySchema,
  WatchRoomMessageSchema,
  WatchRoomStateSchema,
  WatchRoomUpdateSchema,
  type WatchRoomCreateInput,
  type WatchRoomInviteInput,
  type WatchRoomJoinInput,
  type WatchRoomListQuery,
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

  /** 登录 + 角色校验 preHandler */
  const authed = [
    fastify.authenticate,
    fastify.rbac.requireRoleAtLeast('user')
  ];

  /**
   * 公开房间列表（放映室大厅；游客可见，仅返回 open + public 房间，
   * 支持分页 / 按在线人数或创建时间排序 / 房间名称与观看动漫搜索）
   */
  fastify.get<{ Querystring: WatchRoomListQuery }>(
    '/',
    {
      preHandler: [fastify.authenticate],
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
      const list = await service.listPublicRooms(request.query);
      return reply.success('获取公开房间列表成功', list);
    }
  );

  /** 获取当前用户所在房间（跨设备状态恢复；不在任何房间时 data 为 null） */
  fastify.get(
    '/current',
    {
      preHandler: authed,
      schema: {
        response: {
          200: SuccessResponseSchema(WatchRoomStateSchema.nullable())
        }
      }
    },
    async (request, reply) => {
      const state = await service.getCurrentRoom(request.sessionData!.userId);
      return reply.success(
        state ? '获取当前房间成功' : '当前不在任何房间中',
        state
      );
    }
  );

  /** 创建房间（创建者自动成为房主并进入房间；已在其他房间则按切换规则处理） */
  fastify.post<{ Body: WatchRoomCreateInput }>(
    '/',
    {
      preHandler: authed,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: WatchRoomCreateSchema,
        response: { 200: SuccessResponseSchema(WatchRoomStateSchema) }
      }
    },
    async (request, reply) => {
      try {
        const userId = request.sessionData!.userId;
        const room = await service.createRoom(userId, request.body);
        const state = await service.getRoomState(userId, room.id);
        return reply.success('房间创建成功', state);
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );

  /** 获取房间详情（私人房间对非成员等同不存在，防泄露） */
  fastify.get<{ Params: { roomId: string } }>(
    '/:roomId',
    {
      preHandler: [
        fastify.authenticate,
        fastify.rbac.requireRoleAtLeast('user')
      ],
      schema: {
        params: z.object({ roomId: IdSchema }),
        response: { 200: SuccessResponseSchema(WatchRoomDetailSchema) }
      }
    },
    async (request, reply) => {
      try {
        const detail = await service.getRoomDetail(
          request.params.roomId,
          request.sessionData!.userId
        );
        return reply.success('获取房间详情成功', detail);
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );

  /**
   * 加入房间（统一入口：公开直接加入 / 私人凭证 + 密码校验，
   * 全平台单房间切换规则在此统一执行）
   */
  fastify.post<{
    Params: { roomId: string };
    Body: WatchRoomJoinInput;
  }>(
    '/:roomId/join',
    {
      preHandler: authed,
      config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ roomId: IdSchema }),
        body: WatchRoomJoinSchema,
        response: { 200: SuccessResponseSchema(WatchRoomStateSchema) }
      }
    },
    async (request, reply) => {
      try {
        const userId = request.sessionData!.userId;
        const outcome = await service.joinRoom(
          userId,
          request.params.roomId,
          request.body
        );
        const state = await service.getRoomState(userId, request.params.roomId);
        return reply.success(
          outcome.alreadyJoined ? '已在房间内' : '加入房间成功',
          state
        );
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );

  /**
   * 邀请链接直连加入：凭 token 解析房间并执行完整加入校验
   * （静态路由优先于 /:roomId/join 参数路由）
   */
  fastify.post<{ Body: { token: string; password?: string } }>(
    '/invite/join',
    {
      preHandler: authed,
      config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          token: z.string().trim().min(10).max(128),
          password: z.string().max(32).optional()
        }),
        response: { 200: SuccessResponseSchema(WatchRoomStateSchema) }
      }
    },
    async (request, reply) => {
      try {
        const state = await service.joinRoomByInvite(
          request.sessionData!.userId,
          request.body
        );
        return reply.success('加入房间成功', state);
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );

  /** 获取房间完整状态（成员视角；重连/校正用） */
  fastify.get<{ Params: { roomId: string } }>(
    '/:roomId/state',
    {
      preHandler: authed,
      schema: {
        params: z.object({ roomId: IdSchema }),
        response: { 200: SuccessResponseSchema(WatchRoomStateSchema) }
      }
    },
    async (request, reply) => {
      try {
        const state = await service.getRoomState(
          request.sessionData!.userId,
          request.params.roomId
        );
        return reply.success('获取房间状态成功', state);
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
        response: {
          200: SuccessResponseSchema(
            z.object({
              items: z.array(WatchRoomMessageSchema),
              total: z.number()
            })
          )
        }
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

  /** 修改房间信息（房主） */
  fastify.patch<{
    Params: { roomId: string };
    Body: WatchRoomUpdateInput;
  }>(
    '/:roomId',
    {
      preHandler: authed,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ roomId: IdSchema }),
        body: WatchRoomUpdateSchema,
        response: { 200: SuccessResponseSchema(WatchRoomDetailSchema) }
      }
    },
    async (request, reply) => {
      try {
        await service.updateRoom(
          request.sessionData!.userId,
          request.params.roomId,
          request.body
        );
        const detail = await service.getRoomDetail(
          request.params.roomId,
          request.sessionData!.userId
        );
        return reply.success('房间信息已更新', detail);
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );

  /** 关闭房间（房主；= 解散，所有成员访问权限失效） */
  fastify.delete<{ Params: { roomId: string } }>(
    '/:roomId',
    {
      preHandler: authed,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ roomId: IdSchema }),
        response: {
          200: SuccessResponseSchema(z.object({ roomId: IdSchema }))
        }
      }
    },
    async (request, reply) => {
      try {
        await service.closeRoom(
          request.sessionData!.userId,
          request.params.roomId
        );
        return reply.success('房间已解散', { roomId: request.params.roomId });
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );

  /** 创建/重新生成邀请凭证（私人房间房主；重新生成后旧凭证立即失效） */
  fastify.post<{
    Params: { roomId: string };
    Body: WatchRoomInviteInput;
  }>(
    '/:roomId/invite',
    {
      preHandler: authed,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ roomId: IdSchema }),
        body: WatchRoomInviteSchema,
        response: {
          200: SuccessResponseSchema(WatchRoomInviteSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      try {
        const { token, expiresAt } = await service.createInvite(
          request.sessionData!.userId,
          request.params.roomId,
          request.body
        );
        // 相对路径：前端拼接域名后即得邀请链接，避免后端硬编码域名
        return reply.success('邀请凭证生成成功', {
          roomId: request.params.roomId,
          token,
          inviteUrl: `/watch-room/invite/${token}`,
          expiresAt
        });
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );

  /** 踢出成员（房主；被踢用户全部连接立即失效） */
  fastify.post<{
    Params: { roomId: string };
    Body: { userId: string };
  }>(
    '/:roomId/kick',
    {
      preHandler: authed,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ roomId: IdSchema }),
        body: WatchRoomKickSchema,
        response: {
          200: SuccessResponseSchema(z.object({ kicked: z.boolean() }))
        }
      }
    },
    async (request, reply) => {
      try {
        await service.kickMember(
          request.sessionData!.userId,
          request.params.roomId,
          request.body.userId
        );
        return reply.success('已移出成员', { kicked: true });
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );

  /** 主动离开房间（房主离开 = 解散；普通成员切换房间时传 switched=true） */
  fastify.post<{
    Params: { roomId: string };
    Body: { switched?: boolean };
  }>(
    '/:roomId/leave',
    {
      preHandler: authed,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ roomId: IdSchema }),
        body: z.object({ switched: z.boolean().optional() }),
        response: {
          200: SuccessResponseSchema(z.object({ left: z.boolean() }))
        }
      }
    },
    async (request, reply) => {
      try {
        await service.leaveRoom(request.sessionData!.userId, {
          switched: request.body?.switched
        });
        return reply.success('已离开房间', { left: true });
      } catch (error) {
        return handleRoomError(reply)(error);
      }
    }
  );
}
