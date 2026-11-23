import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from '../columns.helpers.js';
import { usersTable } from '../users/index.js';
import { videosTable } from '../videos/index.js';
import {
  watchRoomMemberRoleEnum,
  watchRoomMessageTypeEnum,
  watchRoomVisibilityEnum
} from './enums.js';

/**
 * 房间人数上限（默认值）：建房时固定按此值写入，不开放给客户端指定，
 * 后续也没有任何接口可修改。字段保留是为了兼容历史房间的旧上限。
 */
export const WATCH_ROOM_MAX_MEMBERS = 5;

/**
 * 放映室表：房间存在即开放，解散直接硬删除
 * （历史消息/成员随房间级联删除，无软关闭保留期）
 */
export const watchRoomsTable = pgTable(
  'watch_rooms',
  {
    id: idColumn(),
    /** 房主用户ID（房主账号删除时房间级联删除） */
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    /** 房间名称 */
    name: varchar({ length: 100 }).notNull(),
    /** 房间公告 */
    announcement: varchar({ length: 500 }),
    /** 房间类型：public 公开 / private 私人 */
    visibility: watchRoomVisibilityEnum().notNull(),
    /** 房间密码哈希（scrypt，仅私人房间可选） */
    passwordHash: text('password_hash'),
    /** 最大成员数（建房时固定 5 人，不开放修改） */
    maxMembers: integer('max_members')
      .notNull()
      .default(WATCH_ROOM_MAX_MEMBERS),
    /** 当前播放视频ID */
    currentVideoId: uuid('current_video_id').references(() => videosTable.id, {
      onDelete: 'set null'
    }),
    /** 权威播放位置（秒）：暂停/seek/切视频时写入，播放中由时间推算 */
    playbackPosition: real('playback_position').notNull().default(0),
    /** 是否正在播放 */
    isPlaying: boolean('is_playing').notNull().default(false),
    /** 播放状态版本号：每次状态变更递增，客户端用于丢弃过期同步 */
    playbackRevision: integer('playback_revision').notNull().default(0),
    /** 最近一次播放状态更新时间（推算当前进度用） */
    playbackUpdatedAt: timestamp('playback_updated_at', {
      withTimezone: true,
      mode: 'date'
    })
      .notNull()
      .defaultNow(),
    ...timestamps
  },
  table => [
    index('watch_rooms_owner_idx').on(table.ownerId),
    index('watch_rooms_visibility_idx').on(table.visibility),
    index('watch_rooms_created_idx').on(table.createdAt)
  ]
);

/**
 * 放映室成员表：只保存在房成员（单会话模型：在房即连接中），
 * 离开 / 被踢 / 断开时直接删除记录
 */
export const watchRoomMembersTable = pgTable(
  'watch_room_members',
  {
    id: idColumn(),
    /** 房间ID */
    roomId: uuid('room_id')
      .notNull()
      .references(() => watchRoomsTable.id, { onDelete: 'cascade' }),
    /** 用户ID */
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    /** 角色：owner 房主 / member 普通成员 */
    role: watchRoomMemberRoleEnum().notNull().default('member'),
    ...timestamps
  },
  table => [
    index('watch_room_members_room_idx').on(table.roomId),
    // 全平台单房间限制：一个用户全局最多一条成员记录
    uniqueIndex('uq_watch_room_members_user').on(table.userId)
  ]
);

/** 放映室消息表（聊天消息 + 系统通知统一存储） */
export const watchRoomMessagesTable = pgTable(
  'watch_room_messages',
  {
    id: idColumn(),
    /** 房间ID */
    roomId: uuid('room_id')
      .notNull()
      .references(() => watchRoomsTable.id, { onDelete: 'cascade' }),
    /**
     * 发送者（系统通知为 null）。
     * 发送者账号删除时其消息级联删除
     */
    userId: uuid('user_id').references(() => usersTable.id, {
      onDelete: 'cascade'
    }),
    /** 类型：chat 聊天 / system 系统通知 */
    type: watchRoomMessageTypeEnum().notNull(),
    /** 系统事件类型（普通聊天为 null） */
    eventType: varchar('event_type', { length: 50 }),
    /** 消息内容 / 系统通知展示文本 */
    content: varchar({ length: 500 }).notNull(),
    /** 系统通知结构化元数据（操作者、目标用户等） */
    metadata: jsonb('metadata'),
    ...timestamps
  },
  table => [
    index('watch_room_messages_room_created_idx').on(
      table.roomId,
      table.createdAt
    )
  ]
);

/**
 * 放映室黑名单：被房主移出的成员记录在案，该房间从此拒绝其加入。
 * 房间解散时级联删除（房间不跨进程存活，黑名单也随之失效）。
 */
export const watchRoomBansTable = pgTable(
  'watch_room_bans',
  {
    id: idColumn(),
    /** 房间ID */
    roomId: uuid('room_id')
      .notNull()
      .references(() => watchRoomsTable.id, { onDelete: 'cascade' }),
    /** 被移出的用户ID */
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    ...timestamps
  },
  table => [
    // 同一房间对同一用户只留一条（重复移出幂等）
    uniqueIndex('uq_watch_room_bans_room_user').on(table.roomId, table.userId)
  ]
);
