import {
  index,
  integer,
  pgTable,
  real,
  unique,
  varchar
} from 'drizzle-orm/pg-core';
import { timestamps } from '../columns.helpers.js';
import { animeTable } from '../anime/index.js';

/** 视频表 */
export const videosTable = pgTable(
  'videos',
  {
    /** 视频ID */
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** 动漫ID (外键) */
    animeId: integer('anime_id')
      .notNull()
      .references(() => animeTable.id, { onDelete: 'cascade' }),
    /** 视频标题 */
    title: varchar({ length: 100 }).notNull(),
    /** 视频编号 */
    episode: real().notNull(),
    /** 视频链接 */
    url: varchar({ length: 255 }).notNull(),
    /** 视频播放次数 */
    views: integer().notNull().default(0),
    ...timestamps
  },
  table => [
    index('videos_anime_id_idx').on(table.animeId),
    index('videos_views_idx').on(table.views),
    // 同一番剧下每集唯一，防止并发插入重复剧集
    unique('videos_anime_episode_unique').on(table.animeId, table.episode)
  ]
);
