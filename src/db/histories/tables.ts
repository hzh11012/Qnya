import { pgTable, real, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from '../columns.helpers.js';
import { animeTable } from '../anime/index.js';
import { usersTable } from '../users/index.js';
import { videosTable } from '../videos/tables.js';

/** 历史记录表：同一用户对同一动漫仅一条记录（记录最后观看的集与进度） */
export const historiesTable = pgTable(
  'histories',
  {
    /** 历史记录ID */
    id: idColumn(),
    /** 用户ID (外键) */
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    /** 动漫ID (外键) */
    animeId: uuid('anime_id')
      .notNull()
      .references(() => animeTable.id, { onDelete: 'cascade' }),
    /** 最后观看的视频ID (外键) */
    videoId: uuid('video_id')
      .notNull()
      .references(() => videosTable.id, { onDelete: 'cascade' }),
    /** 历史记录视频时间 */
    time: real('time').notNull(),
    ...timestamps
  },
  table => [
    unique('histories_user_anime_unique').on(table.userId, table.animeId)
  ]
);
