import { z } from 'zod';
import { IdSchema } from './common.js';
import { ClientAnimeStatusSchema } from './play.js';

/** 首页推荐条目（竖版 3/4 卡） */
export const HomeAnimeItemSchema = z.object({
  animeId: IdSchema,
  /** 用于跳转播放页的集数 id（取第一集） */
  videoId: IdSchema.nullable(),
  name: z.string(),
  cover: z.string().nullable(),
  remark: z.string().nullable(),
  status: ClientAnimeStatusSchema,
  videoCount: z.number()
});

/** 我的追番条目（横版 16/9 卡，用 banner；带观看进度） */
export const HomeCollectionItemSchema = HomeAnimeItemSchema.omit({
  cover: true
}).extend({
  banner: z.string().nullable(),
  /** 观看到的集数（无观看记录为 null） */
  episode: z.number().nullable(),
  /** 观看进度秒数（无观看记录为 null） */
  time: z.number().nullable()
});

/** 类型推荐行（adult 类型仅对高级会员/管理员可见） */
export const HomeTypeRowSchema = z.object({
  type: z.enum(['movie', 'japanese', 'american', 'chinese', 'adult']),
  items: z.array(HomeAnimeItemSchema)
});

export const HomeResponseSchema = z.object({
  /** 我的追番（仅登录且有追番数据时非空） */
  collections: z.array(HomeCollectionItemSchema),
  /** 各类型推荐（无数据的类型不会返回） */
  animeTypes: z.array(HomeTypeRowSchema)
});

export type HomeResponse = z.infer<typeof HomeResponseSchema>;
