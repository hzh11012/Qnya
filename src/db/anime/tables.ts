import {
  index,
  integer,
  pgTable,
  real,
  smallint,
  text,
  unique,
  varchar
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from '../columns.helpers.js';
import { animeMonthEnum, animeStatusEnum, animeTypeEnum } from './enums.js';
import { seriesTable } from '../series/index.js';

/** 动漫表 */
export const animeTable = pgTable(
  'anime',
  {
    /** 动漫ID */
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** 所属系列ID (外键) */
    seriesId: integer('series_id')
      .notNull()
      .references(() => seriesTable.id, { onDelete: 'cascade' }),
    /** 动漫名 */
    name: varchar({ length: 100 }).notNull(),
    /** 动漫简介 */
    description: text().notNull(),
    /** 动漫短评 */
    remark: varchar({ length: 25 }).notNull(),
    /** 动漫封面 */
    cover: varchar({ length: 255 }).notNull(),
    /** 动漫横幅 */
    banner: varchar({ length: 255 }).notNull(),
    /** 动漫状态 */
    status: animeStatusEnum().notNull(),
    /** 动漫类型 */
    type: animeTypeEnum().notNull(),
    /** 动漫年份 */
    year: smallint().notNull(),
    /** 动漫月份 */
    month: animeMonthEnum().notNull(),
    /** 动漫导演 */
    director: varchar({ length: 25 }).notNull(),
    /** 动漫声优 */
    cv: text().notNull(),
    /** 动漫所属季 */
    season: smallint().notNull(),
    /** 动漫所属季名称 */
    seasonName: varchar('season_name', { length: 25 }),
    /** 动漫平均评分 */
    avgScore: real('avg_score').notNull().default(0),
    /** 动漫评分人数 */
    scoreCount: integer('score_count').notNull().default(0),
    /** 名称全拼（用于拼音搜索） */
    namePinyin: varchar('name_pinyin', { length: 300 }),
    /** 名称首字母（用于缩写搜索） */
    nameInitials: varchar('name_initials', { length: 100 }),
    ...timestamps
  },
  table => [
    index('anime_series_id_idx').on(table.seriesId),
    index('anime_name_idx').on(table.name),
    // 同一系列下每季唯一，防止并发插入重复番剧（路由层的预检查存在竞态）
    unique('anime_series_season_unique').on(table.seriesId, table.season),
    index('anime_filter_idx').on(
      table.type,
      table.status,
      table.year,
      table.month
    ),
    index('anime_name_pinyin_trgm_idx').using(
      'gin',
      sql`${table.namePinyin} gin_trgm_ops`
    ),
    index('anime_name_initials_trgm_idx').using(
      'gin',
      sql`${table.nameInitials} gin_trgm_ops`
    )
  ]
);
