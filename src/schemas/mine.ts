import { z } from 'zod';
import { IdSchema, PaginationQuerySchema } from './common.js';

/** 我的页面列表分页参数 */
export const MineListQuerySchema = z.preprocess(
  val => val ?? {},
  z.object({ ...PaginationQuerySchema })
);

export type MineListQuery = z.infer<typeof MineListQuerySchema>;

/** 我的追番条目（name 已含季后缀，videoId 为该番第一集，用于跳转播放） */
export const MineCollectionItemSchema = z.object({
  animeId: IdSchema,
  name: z.string(),
  cover: z.string(),
  status: z.enum(['upcoming', 'airing', 'completed']),
  videoCount: z.number(),
  avgScore: z.number(),
  videoId: IdSchema.nullable(),
  collectedAt: z.date()
});

/** 我的历史条目（videoId 为最后观看的一集，time 为该集进度秒数） */
export const MineHistoryItemSchema = z.object({
  animeId: IdSchema,
  name: z.string(),
  banner: z.string(),
  videoId: IdSchema.nullable(),
  episode: z.number().nullable(),
  videoTitle: z.string().nullable(),
  time: z.number(),
  watchedAt: z.date()
});
