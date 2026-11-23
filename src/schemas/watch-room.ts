import { z } from 'zod';
import {
  IdSchema,
  PaginationQuerySchema,
  SuccessResponseSchema
} from './common.js';

// ============================================
// 系统事件类型（watch_room_messages.event_type）
// ============================================

export const WATCH_ROOM_EVENT_TYPES = [
  'member_joined',
  'member_left',
  'member_kicked',
  'room_updated',
  'video_changed'
] as const;

export type WatchRoomEventType = (typeof WATCH_ROOM_EVENT_TYPES)[number];

// ============================================
// 错误码（HTTP 与 Socket ACK 保持一致）
// ============================================

export const WATCH_ROOM_ERROR_CODES = [
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_PRIVATE',
  'ROOM_PASSWORD_INVALID',
  'ROOM_BANNED',
  'ROOM_PERMISSION_DENIED',
  'ROOM_MEMBER_NOT_FOUND',
  'VIDEO_NOT_FOUND',
  'VIDEO_UNAVAILABLE',
  'SESSION_INVALID',
  'RATE_LIMITED',
  'INVALID_PARAMS',
  'INTERNAL_ERROR'
] as const;

export type WatchRoomErrorCode = (typeof WATCH_ROOM_ERROR_CODES)[number];

/** 错误码 → HTTP 状态码映射 */
export const WATCH_ROOM_ERROR_STATUS: Record<WatchRoomErrorCode, number> = {
  ROOM_NOT_FOUND: 404,
  ROOM_FULL: 409,
  ROOM_PRIVATE: 403,
  ROOM_PASSWORD_INVALID: 403,
  ROOM_BANNED: 403,
  ROOM_PERMISSION_DENIED: 403,
  ROOM_MEMBER_NOT_FOUND: 404,
  VIDEO_NOT_FOUND: 404,
  VIDEO_UNAVAILABLE: 409,
  SESSION_INVALID: 401,
  RATE_LIMITED: 429,
  INVALID_PARAMS: 400,
  INTERNAL_ERROR: 500
};

/**
 * 错误响应（OpenAPI 文档用）：业务错误附带 errorCode 供前端区分处理；
 * 框架层错误（未登录 / 参数校验 / 限流）只有 code 与 message
 */
export const WatchRoomErrorResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  errorCode: z.enum(WATCH_ROOM_ERROR_CODES).optional()
});

/** 放映室接口响应声明：200 成功结构 + 各错误状态码的错误结构 */
export const withRoomErrors = <T extends z.ZodTypeAny>(data: T) => ({
  200: SuccessResponseSchema(data),
  400: WatchRoomErrorResponseSchema,
  401: WatchRoomErrorResponseSchema,
  403: WatchRoomErrorResponseSchema,
  404: WatchRoomErrorResponseSchema,
  409: WatchRoomErrorResponseSchema,
  429: WatchRoomErrorResponseSchema
});

// ============================================
// 请求 Schema
// ============================================

export const WatchRoomVisibilitySchema = z.enum(['public', 'private']);

/** 创建房间 */
export const WatchRoomCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '房间名称不能为空')
    .max(100, '房间名称最多 100 字'),
  visibility: WatchRoomVisibilitySchema,
  announcement: z.string().trim().max(500, '公告最多 500 字').optional(),
  /** 私人房间密码（私人房间必填，公开房间不可设置） */
  password: z
    .string()
    .min(4, '密码至少 4 位')
    .max(32, '密码最多 32 位')
    .optional(),
  /** 初始视频（必选：先选番剧再选集） */
  videoId: IdSchema
});

export type WatchRoomCreateInput = z.infer<typeof WatchRoomCreateSchema>;

/** 公开房间列表查询（按开播时间倒序分页） */
export const WatchRoomListQuerySchema = z.object({
  ...PaginationQuerySchema
});

export type WatchRoomListQuery = z.infer<typeof WatchRoomListQuerySchema>;

/** 加入房间 */
export const WatchRoomJoinSchema = z.object({
  /** 私人房间密码 */
  password: z.string().max(32).optional()
});

export type WatchRoomJoinInput = z.infer<typeof WatchRoomJoinSchema>;

/** 房间基本信息字段（名称/公告，房主与管理端共用） */
const WatchRoomInfoShape = {
  name: z
    .string()
    .trim()
    .min(1, '房间名称不能为空')
    .max(100, '房间名称最多 100 字')
    .optional(),
  announcement: z.string().trim().max(500, '公告最多 500 字').optional()
};

type WatchRoomInfoPatch = { name?: string; announcement?: string };

const hasInfoField = (data: WatchRoomInfoPatch) =>
  data.name !== undefined || data.announcement !== undefined;

/** 修改房间信息（房主）：名称/公告/公开状态，转私人时同时给出密码 */
export const WatchRoomUpdateSchema = z
  .object({
    ...WatchRoomInfoShape,
    visibility: WatchRoomVisibilitySchema.optional(),
    /** 转为私人房间时设置的密码（房间已是私人且已设过密码时可省略） */
    password: z
      .string()
      .min(4, '密码至少 4 位')
      .max(32, '密码最多 32 位')
      .optional()
  })
  .refine(data => hasInfoField(data) || data.visibility !== undefined, {
    message: '至少修改一项内容'
  })
  .refine(
    data => data.password === undefined || data.visibility === 'private',
    {
      message: '密码只能随私人房间设置'
    }
  );

export type WatchRoomUpdateInput = z.infer<typeof WatchRoomUpdateSchema>;

/** 踢出成员 */
export const WatchRoomKickSchema = z.object({ userId: IdSchema });

/** 发送聊天消息 */
export const WatchRoomChatSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, '消息内容不能为空')
    .max(200, '消息最多 200 字')
});

export type WatchRoomChatInput = z.infer<typeof WatchRoomChatSchema>;

/** 消息历史查询 */
export const WatchRoomMessageQuerySchema = z.object({
  ...PaginationQuerySchema
});

// ============================================
// Socket 事件载荷 Schema（Socket.IO 不经过 Fastify 校验，事件处理器内显式解析）
// ============================================

const SocketRoomIdShape = { roomId: IdSchema };

/** 播放位置（秒）：上限 7 天，拒绝 NaN/Infinity/负数 */
const PlaybackPositionSchema = z
  .number()
  .min(0)
  .max(86400 * 7);

/** 仅携带 roomId 的事件（playback:pause） */
export const WatchRoomSocketRoomSchema = z.object(SocketRoomIdShape);

export const WatchRoomSocketJoinSchema =
  WatchRoomJoinSchema.extend(SocketRoomIdShape);

/**
 * room:leave：必须带 roomId。
 *
 * 不带 roomId 时服务端会退出「当前所在房间」——旧标签页发一条裸 leave 就能把
 * 用户刚切换过去的新房间（房主即解散）误关掉，因此这里强制指定房间。
 * 登出等「退出当前房间」场景走 service.leaveRoom(userId) 的内部调用，不经过这里。
 */
export const WatchRoomSocketLeaveSchema = z.object({
  roomId: IdSchema
});

/** room:update：roomId + 房主可改的字段（保留 WatchRoomUpdateSchema 的约束） */
export const WatchRoomSocketUpdateSchema =
  WatchRoomUpdateSchema.safeExtend(SocketRoomIdShape);

export const WatchRoomSocketKickSchema =
  WatchRoomKickSchema.extend(SocketRoomIdShape);

/** playback:play：附带 position 时从该位置开始播放 */
export const WatchRoomSocketPlaySchema = z.object({
  ...SocketRoomIdShape,
  position: PlaybackPositionSchema.optional()
});

export const WatchRoomSocketSeekSchema = z.object({
  ...SocketRoomIdShape,
  position: PlaybackPositionSchema
});

export const WatchRoomSocketChangeVideoSchema = z.object({
  ...SocketRoomIdShape,
  videoId: IdSchema,
  /** 换集后直接从 0 起播（自动连播用）；手动选集不传，保持「切完暂停」 */
  autoplay: z.boolean().optional()
});

export const WatchRoomSocketChatSchema =
  WatchRoomChatSchema.extend(SocketRoomIdShape);

// ============================================
// 响应 Schema
// ============================================

/** 用户简要信息 */
export const WatchRoomUserBriefSchema = z.object({
  userId: IdSchema,
  nickname: z.string(),
  avatar: z.string().nullable()
});

export type WatchRoomUserBrief = z.infer<typeof WatchRoomUserBriefSchema>;

/** 系统通知结构 */
export const WatchRoomSystemInfoSchema = z.object({
  eventType: z.enum(WATCH_ROOM_EVENT_TYPES),
  operator: WatchRoomUserBriefSchema.optional(),
  target: WatchRoomUserBriefSchema.optional()
});

/** 房间消息（聊天 + 系统通知统一结构） */
export const WatchRoomMessageSchema = z.object({
  messageId: IdSchema,
  roomId: IdSchema,
  type: z.enum(['chat', 'system']),
  content: z.string(),
  createdAt: z.date(),
  user: WatchRoomUserBriefSchema.optional(),
  system: WatchRoomSystemInfoSchema.optional()
});

export type WatchRoomMessage = z.infer<typeof WatchRoomMessageSchema>;

/** 当前播放视频信息 */
export const WatchRoomVideoSchema = z.object({
  videoId: IdSchema,
  title: z.string(),
  episode: z.number(),
  animeId: IdSchema,
  animeName: z.string(),
  animeCover: z.string()
});

export type WatchRoomVideo = z.infer<typeof WatchRoomVideoSchema>;

/** 权威播放状态 */
export const WatchRoomPlaybackSchema = z.object({
  videoId: IdSchema.nullable(),
  /** 服务端推算的当前播放位置（秒） */
  position: z.number(),
  isPlaying: z.boolean(),
  /** 状态版本号（客户端丢弃过期同步） */
  revision: z.number(),
  /** 服务端时间戳（ms，客户端校正本地进度用） */
  serverTime: z.number()
});

export type WatchRoomPlayback = z.infer<typeof WatchRoomPlaybackSchema>;

/** 成员条目（单会话模型：在房成员即在线成员） */
export const WatchRoomMemberSchema = z.object({
  userId: IdSchema,
  nickname: z.string(),
  avatar: z.string().nullable(),
  role: z.enum(['owner', 'member']),
  joinedAt: z.date()
});

export type WatchRoomMember = z.infer<typeof WatchRoomMemberSchema>;

/** 房间详情（大厅 / 详情页共用） */
export const WatchRoomDetailSchema = z.object({
  id: IdSchema,
  name: z.string(),
  announcement: z.string().nullable(),
  visibility: WatchRoomVisibilitySchema,
  ownerId: IdSchema,
  owner: WatchRoomUserBriefSchema,
  memberCount: z.number(),
  maxMembers: z.number(),
  playback: WatchRoomPlaybackSchema,
  currentVideo: WatchRoomVideoSchema.nullable(),
  createdAt: z.date()
});

export type WatchRoomDetail = z.infer<typeof WatchRoomDetailSchema>;

/** 房间完整状态（成员视角） */
export const WatchRoomStateSchema = WatchRoomDetailSchema.extend({
  members: z.array(WatchRoomMemberSchema),
  me: z.object({ role: z.enum(['owner', 'member']) })
});

export type WatchRoomState = z.infer<typeof WatchRoomStateSchema>;

/** 公开房间列表条目 */
export const WatchRoomListItemSchema = z.object({
  id: IdSchema,
  name: z.string(),
  ownerId: IdSchema,
  owner: WatchRoomUserBriefSchema,
  memberCount: z.number(),
  maxMembers: z.number(),
  isPlaying: z.boolean(),
  currentVideo: WatchRoomVideoSchema.nullable(),
  createdAt: z.date()
});

export type WatchRoomListItem = z.infer<typeof WatchRoomListItemSchema>;

// ============================================
// 后台管理（admin）Schema
// ============================================

/** 管理端房间列表查询（含私人房间，按房名或房主昵称搜索） */
export const AdminWatchRoomListQuerySchema = z.object({
  ...PaginationQuerySchema,
  visibility: WatchRoomVisibilitySchema.optional(),
  /** 房间名称 / 房主昵称搜索 */
  keyword: z.string().trim().max(100).optional()
});

export type AdminWatchRoomListQuery = z.infer<
  typeof AdminWatchRoomListQuerySchema
>;

/** 管理端房间列表条目 */
export const AdminWatchRoomListItemSchema = z.object({
  id: IdSchema,
  name: z.string(),
  announcement: z.string().nullable(),
  visibility: WatchRoomVisibilitySchema,
  ownerId: IdSchema,
  owner: WatchRoomUserBriefSchema,
  memberCount: z.number(),
  maxMembers: z.number(),
  isPlaying: z.boolean(),
  currentVideo: WatchRoomVideoSchema.nullable(),
  createdAt: z.date()
});

export type AdminWatchRoomListItem = z.infer<
  typeof AdminWatchRoomListItemSchema
>;

/** 管理端编辑房间（只改名称/公告，公开状态与密码归房主） */
export const AdminWatchRoomUpdateSchema = z
  .object(WatchRoomInfoShape)
  .refine(hasInfoField, { message: '至少修改一项内容' });

/** 管理端房间成员（只读：单会话模型下在房成员即在线成员） */
export const AdminWatchRoomMemberSchema = z.object({
  userId: IdSchema,
  nickname: z.string(),
  avatar: z.string().nullable(),
  role: z.enum(['owner', 'member']),
  joinedAt: z.date()
});

export type AdminWatchRoomMember = z.infer<typeof AdminWatchRoomMemberSchema>;

/** 管理端黑名单条目（被房主移出、当前无法再加入该房间的用户） */
export const AdminWatchRoomBanSchema = z.object({
  userId: IdSchema,
  nickname: z.string(),
  avatar: z.string().nullable(),
  bannedAt: z.date()
});

export type AdminWatchRoomBan = z.infer<typeof AdminWatchRoomBanSchema>;

/** 管理端消息记录查询：可按类型筛选（chat / system） */
export const AdminWatchRoomMessageQuerySchema = z.object({
  ...PaginationQuerySchema,
  type: z.enum(['chat', 'system']).optional()
});

export type AdminWatchRoomMessageQuery = z.infer<
  typeof AdminWatchRoomMessageQuerySchema
>;
