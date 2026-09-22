import { index, pgTable, real, uuid, varchar } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from '../columns.helpers.js';
import { usersTable } from '../users/index.js';
import { videosTable } from '../videos/index.js';
import { danmakuTypeEnum } from './enums.js';

/** 弹幕表 */
export const danmakuTable = pgTable(
  'danmaku',
  {
    /** 弹幕ID */
    id: idColumn(),
    /** 用户ID (外键) */
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    /** 视频ID (外键) */
    videoId: uuid('video_id')
      .notNull()
      .references(() => videosTable.id, { onDelete: 'cascade' }),
    /** 弹幕内容 */
    text: varchar({ length: 50 }).notNull(),
    /** 弹幕类型 */
    mode: danmakuTypeEnum().notNull().default('scroll'),
    /** 弹幕颜色（十六进制） */
    color: varchar({ length: 7 }).notNull(),
    /** 弹幕视频时间 */
    time: real('time').notNull(),
    ...timestamps
  },
  table => [
    index('danmaku_user_id_idx').on(table.userId),
    index('danmaku_video_id_idx').on(table.videoId)
  ]
);
