import { z } from 'zod';
import { IdSchema, PaginationQuerySchema } from './common.js';

// ============================================
// 系统事件类型（watch_room_messages.event_type）
// ============================================

export const WATCH_ROOM_EVENT_TYPES = [
  'member_joined',
  'member_left',
  'member_switched',
  'member_kicked',
  'member_invited',
  'room_updated',
  'room_closed'
] as const;

export type WatchRoomEventType = (typeof WATCH_ROOM_EVENT_TYPES)[number];

// ============================================
// 错误码（HTTP 与 Socket ACK 保持一致）
// ============================================

export const WATCH_ROOM_ERROR_CODES = [
  'ROOM_NOT_FOUND',
  'ROOM_CLOSED',
  'ROOM_FULL',
  'ROOM_PRIVATE',
  'INVITE_INVALID',
  'INVITE_EXPIRED',
  'ROOM_PASSWORD_INVALID',
  'ROOM_PERMISSION_DENIED',
  'ROOM_MEMBER_NOT_FOUND',
  'ROOM_ALREADY_JOINED',
  'ROOM_SWITCH_FAILED',
  'VIDEO_NOT_FOUND',
  'VIDEO_UNAVAILABLE',
  'SESSION_INVALID',
  'RATE_LIMITED'
] as const;

export type WatchRoomErrorCode = (typeof WATCH_ROOM_ERROR_CODES)[number];

/** 错误码 → HTTP 状态码映射 */
export const WATCH_ROOM_ERROR_STATUS: Record<WatchRoomErrorCode, number> = {
  ROOM_NOT_FOUND: 404,
  ROOM_CLOSED: 409,
  ROOM_FULL: 409,
  ROOM_PRIVATE: 403,
  INVITE_INVALID: 403,
  INVITE_EXPIRED: 403,
  ROOM_PASSWORD_INVALID: 403,
  ROOM_PERMISSION_DENIED: 403,
  ROOM_MEMBER_NOT_FOUND: 404,
  ROOM_ALREADY_JOINED: 200,
  ROOM_SWITCH_FAILED: 409,
  VIDEO_NOT_FOUND: 404,
  VIDEO_UNAVAILABLE: 409,
  SESSION_INVALID: 401,
  RATE_LIMITED: 429
};

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
  /** 仅私人房间可设置密码 */
  password: z
    .string()
    .min(4, '密码至少 4 位')
    .max(32, '密码最多 32 位')
    .optional(),
  /** 初始视频 */
  videoId: IdSchema.optional()
});

export type WatchRoomCreateInput = z.infer<typeof WatchRoomCreateSchema>;

/** 公开房间列表查询 */
export const WatchRoomListQuerySchema = z.object({
  ...PaginationQuerySchema,
  /** online 按在线人数排序 / createdAt 按创建时间排序 */
  sort: z.enum(['online', 'createdAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  /** 房间名称 / 当前观看动漫搜索 */
  keyword: z.string().trim().max(100).optional()
});

export type WatchRoomListQuery = z.infer<typeof WatchRoomListQuerySchema>;

/** 加入房间 */
export const WatchRoomJoinSchema = z.object({
  /** 私人房间邀请凭证（邀请链接 / 邀请码中的 token） */
  inviteToken: z.string().trim().min(10).max(128).optional(),
  /** 私人房间密码 */
  password: z.string().max(32).optional()
});

export type WatchRoomJoinInput = z.infer<typeof WatchRoomJoinSchema>;

/** 修改房间信息（房主） */
export const WatchRoomUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, '房间名称不能为空')
      .max(100, '房间名称最多 100 字')
      .optional(),
    announcement: z.string().trim().max(500, '公告最多 500 字').optional()
  })
  .refine(data => data.name !== undefined || data.announcement !== undefined, {
    message: '至少修改一项内容'
  });

export type WatchRoomUpdateInput = z.infer<typeof WatchRoomUpdateSchema>;

/** 踢出成员 */
export const WatchRoomKickSchema = z.object({ userId: IdSchema });

/** 创建邀请 */
export const WatchRoomInviteSchema = z.object({
  /** 被邀请用户（可选：生成邀请通知，仅代表邀请已发出） */
  userId: IdSchema.optional(),
  /** 凭证有效期（天，可选：不传 = 永不过期） */
  expiresInDays: z.coerce.number().int().min(1).max(365).optional()
});

export type WatchRoomInviteInput = z.infer<typeof WatchRoomInviteSchema>;

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
  target: WatchRoomUserBriefSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
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
  onlineCount: z.number(),
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
  me: z.object({
    role: z.enum(['owner', 'member']),
    canControlPlayback: z.boolean()
  })
});

export type WatchRoomState = z.infer<typeof WatchRoomStateSchema>;

/** 公开房间列表条目 */
export const WatchRoomListItemSchema = z.object({
  id: IdSchema,
  name: z.string(),
  ownerId: IdSchema,
  owner: WatchRoomUserBriefSchema,
  onlineCount: z.number(),
  memberCount: z.number(),
  maxMembers: z.number(),
  isPlaying: z.boolean(),
  currentVideo: WatchRoomVideoSchema.nullable(),
  createdAt: z.date()
});

export type WatchRoomListItem = z.infer<typeof WatchRoomListItemSchema>;

/** 邀请凭证 */
export const WatchRoomInviteSchemaResponse = z.object({
  roomId: IdSchema,
  /** 明文凭证（仅创建时返回一次，数据库只存哈希） */
  token: z.string(),
  /** 邀请链接（相对路径，域名由前端自行拼接） */
  inviteUrl: z.string(),
  expiresAt: z.date().nullable()
});

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
  onlineCount: z.number(),
  maxMembers: z.number(),
  isPlaying: z.boolean(),
  currentVideo: WatchRoomVideoSchema.nullable(),
  createdAt: z.date()
});

export type AdminWatchRoomListItem = z.infer<
  typeof AdminWatchRoomListItemSchema
>;

/** 管理端编辑房间（复用客户端 Update 的约束：至少修改一项） */
export const AdminWatchRoomUpdateSchema = WatchRoomUpdateSchema;
