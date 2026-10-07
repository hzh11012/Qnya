import { z } from 'zod';
import { IdSchema } from './common.js';

export const ClientPlayParamsSchema = z.object({ videoId: IdSchema });

export type ClientPlayParams = z.infer<typeof ClientPlayParamsSchema>;

/** 动漫状态（客户端可见，不含 draft） */
export const ClientAnimeStatusSchema = z.enum([
  'upcoming',
  'airing',
  'completed'
]);

/** 系列的其他季 / 推荐条目 */
export const ClientPlayAnimeItemSchema = z.object({
  id: IdSchema,
  name: z.string(),
  season: z.number(),
  seasonName: z.string().nullable(),
  cover: z.string(),
  banner: z.string(),
  status: ClientAnimeStatusSchema,
  videoCount: z.number(),
  videoId: IdSchema.nullable(),
  playCount: z.number(),
  collectionCount: z.number(),
  avgScore: z.number()
});

export type ClientPlayAnimeItem = z.infer<typeof ClientPlayAnimeItemSchema>;

/** 播放详情 */
export const ClientPlayDetailSchema = z.object({
  animeId: IdSchema,
  videoId: IdSchema,
  name: z.string(),
  description: z.string(),
  cover: z.string(),
  status: ClientAnimeStatusSchema,
  avgScore: z.number(),
  scoreCount: z.number(),
  playCount: z.number(),
  collectionCount: z.number(),
  videoCount: z.number(),
  video: z.object({
    id: IdSchema,
    url: z.string(),
    episode: z.number()
  }),
  videos: z.array(
    z.object({
      id: IdSchema,
      episode: z.number(),
      title: z.string()
    })
  ),
  /** 动漫维度唯一历史：最近观看的一集及进度（history.videoId 可能不是当前集） */
  history: z
    .object({
      videoId: IdSchema,
      time: z.number()
    })
    .nullable(),
  /** 当前集恢复进度：仅当历史记录属于当前集时非 0 */
  time: z.number(),
  isCollected: z.boolean(),
  isRating: z.boolean(),
  series: z.array(ClientPlayAnimeItemSchema),
  recommendations: z.array(ClientPlayAnimeItemSchema)
});

export type ClientPlayDetail = z.infer<typeof ClientPlayDetailSchema>;

/** 弹幕条目 */
export const ClientDanmakuItemSchema = z.object({
  text: z.string(),
  color: z.string(),
  mode: z.enum(['scroll', 'top', 'bottom']),
  time: z.number()
});

export type ClientDanmakuItem = z.infer<typeof ClientDanmakuItemSchema>;

export const ClientDanmakuCreateSchema = z.object({
  text: z.string().trim().min(1, '弹幕内容不能为空').max(50, '弹幕最多 50 字'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色格式错误'),
  mode: z.enum(['scroll', 'top', 'bottom']).default('scroll'),
  time: z
    .number()
    .min(0)
    .max(86400 * 7)
});

export type ClientDanmakuCreate = z.infer<typeof ClientDanmakuCreateSchema>;

export const ClientHistoryCreateSchema = z.object({
  time: z
    .number()
    .min(0)
    .max(86400 * 7)
});

export type ClientHistoryCreate = z.infer<typeof ClientHistoryCreateSchema>;

export const ClientRatingCreateSchema = z.object({
  score: z.number().int().min(1, '评分不能为空').max(5),
  content: z
    .string()
    .trim()
    .min(1, '短评内容不能为空')
    .max(1000, '短评最多 1000 字')
});

export type ClientRatingCreate = z.infer<typeof ClientRatingCreateSchema>;
