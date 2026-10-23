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
  videoCount: z.number(),
  /** 加权均分（无人评分时为 0，前端不展示） */
  score: z.number(),
  /** 评分人数（用于判断是否展示评分） */
  scoreCount: z.number()
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

/** 首页轮播条目（横版 banner 大图，精选最近更新的在播番剧） */
export const HomeBannerItemSchema = z.object({
  animeId: IdSchema,
  videoId: IdSchema.nullable(),
  name: z.string(),
  banner: z.string().nullable(),
  description: z.string(),
  remark: z.string().nullable(),
  status: ClientAnimeStatusSchema,
  /** 集数总数（状态胶囊展示「更新至第 N 话」用） */
  videoCount: z.number()
});

export const HomeResponseSchema = z.object({
  /** 首页轮播（每日推荐轮换：质量+新近度+在播+当日随机加权打分，最多 5 个） */
  banners: z.array(HomeBannerItemSchema),
  /** 新番发现（最新入库的番剧，最多 4 个） */
  picks: z.array(HomeAnimeItemSchema),
  /** 我的追番（仅登录且有追番数据时非空） */
  collections: z.array(HomeCollectionItemSchema),
  /** 各类型推荐（无数据的类型不会返回） */
  animeTypes: z.array(HomeTypeRowSchema)
});

export type HomeResponse = z.infer<typeof HomeResponseSchema>;
