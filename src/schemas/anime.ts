import { z } from 'zod';
import { IdSchema, PaginationQuerySchema, ArrayQuerySchema } from './common.js';
import { SearchAnimeItemSchema } from './search.js';

const animeStatus = ['draft', 'upcoming', 'airing', 'completed'] as const;
const animeType = [
  'movie',
  'japanese',
  'american',
  'chinese',
  'adult'
] as const;
const animeMonth = ['january', 'april', 'july', 'october'] as const;

export const AddAnimeSchema = z.object({
  seriesId: IdSchema,
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  remark: z.string().min(1).max(25),
  cover: z.string().min(1).max(255),
  banner: z.string().min(1).max(255),
  status: z.enum(animeStatus),
  type: z.enum(animeType),
  year: z.coerce.number().min(1990).max(new Date().getFullYear()),
  month: z.enum(animeMonth),
  director: z.string().min(1).max(25),
  cv: z.string().min(1).max(1000),
  season: z.coerce.number().min(1).max(100),
  // nullable：管理端允许不填季名称（如第一季），由客户端按季数自行展示
  seasonName: z.string().min(1).max(25).nullable().optional(),
  tags: z.array(IdSchema).min(1)
});

export type AddAnimeBody = z.infer<typeof AddAnimeSchema>;

export const UpdateAnimeParamsSchema = z.object({
  id: IdSchema
});

export type UpdateAnimeParams = z.infer<typeof UpdateAnimeParamsSchema>;

export const UpdateAnimeBodySchema = z.object({
  seriesId: IdSchema.optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(1000).optional(),
  remark: z.string().min(1).max(25).optional(),
  cover: z.string().min(1).max(255).optional(),
  banner: z.string().min(1).max(255).optional(),
  status: z.enum(animeStatus).optional(),
  type: z.enum(animeType).optional(),
  year: z.coerce.number().min(1990).max(new Date().getFullYear()).optional(),
  month: z.enum(animeMonth).optional(),
  director: z.string().min(1).max(25).optional(),
  cv: z.string().min(1).max(1000).optional(),
  season: z.coerce.number().min(1).max(100).optional(),
  // nullable 与 optional 语义不同：null 表示清空该字段，缺省表示不修改
  seasonName: z.string().min(1).max(25).nullable().optional(),
  tags: z.array(IdSchema).min(1).optional()
});

export type UpdateAnimeBody = z.infer<typeof UpdateAnimeBodySchema>;

export const AnimeListSchema = z.preprocess(
  val => val ?? {},
  z.object({
    ...PaginationQuerySchema,
    keyword: z.string().optional(),
    sort: z.enum(['createdAt']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    status: ArrayQuerySchema(z.enum(animeStatus)),
    types: ArrayQuerySchema(z.enum(animeType)),
    tags: ArrayQuerySchema(IdSchema),
    years: ArrayQuerySchema(
      z
        .enum(
          Array.from({ length: new Date().getFullYear() - 1988 }, (_, i) =>
            String(1990 + i)
          )
        )
        .transform(val => parseInt(val, 10))
    ),
    months: ArrayQuerySchema(z.enum(animeMonth))
  })
);

export type AnimeListQuery = z.infer<typeof AnimeListSchema>;

export const AnimeListSchemaResponse = z.object({
  items: z.array(
    z.object({
      id: IdSchema,
      seriesId: IdSchema,
      name: z.string(),
      description: z.string(),
      remark: z.string(),
      cover: z.string(),
      banner: z.string(),
      status: z.enum(animeStatus),
      type: z.enum(animeType),
      year: z.number(),
      month: z.enum(animeMonth),
      director: z.string(),
      cv: z.string(),
      season: z.number(),
      seasonName: z.string().nullable(),
      avgScore: z.number(),
      scoreCount: z.number(),
      tags: z.array(
        z.object({
          id: IdSchema,
          name: z.string()
        })
      ),
      createdAt: z.date()
    })
  ),
  total: z.number()
});

/** 热门列表 query：按评分人数排序 */
export const ClientHotQuerySchema = z.object({
  ...PaginationQuerySchema
});

export type ClientHotQuery = z.infer<typeof ClientHotQuerySchema>;

/** 番剧筛选列表 query：各维度单选（URL 参数友好），tag 为标签 ID */
/** 年份半开区间参数格式：[from,to)，更早为 [,to) */
export const YEAR_RANGE_RE = /^\[(\d{4})?,(\d{4})?\)$/;

/** 解析年份区间参数为 [from, to]（可能含 undefined） */
export const parseYearRange = (year: string) => {
  const [, from, to] = year.match(YEAR_RANGE_RE) ?? [];
  return { from: from && Number(from), to: to && Number(to) };
};

/**
 * 客户端筛选列表的对外参数统一用数字码（URL 简洁），transform 回内部枚举：
 *  - type: 1剧场版 2日番 3美漫 4国创 5里番
 *  - status: 1连载中 2已完结 3即将开播
 *  - month: 1/4/7/10 月
 *  - sort: 1综合 2最高评分 3播放 4追番 5更新（默认 1）
 */
const codeToValue = <T extends string>(map: Record<number, T>) =>
  z.coerce
    .number()
    .refine(n => n in map)
    .transform(n => map[n]);

const TYPE_CODE = {
  1: 'movie',
  2: 'japanese',
  3: 'american',
  4: 'chinese',
  5: 'adult'
} as const;
const STATUS_CODE = { 1: 'airing', 2: 'completed', 3: 'upcoming' } as const;
const MONTH_CODE = {
  1: 'january',
  4: 'april',
  7: 'july',
  10: 'october'
} as const;
const SORT_CODE = {
  1: 'score',
  2: 'rating',
  3: 'views',
  4: 'collections',
  5: 'latest'
} as const;

export const ClientListQuerySchema = z.object({
  ...PaginationQuerySchema,
  type: codeToValue(TYPE_CODE).optional(),
  status: codeToValue(STATUS_CODE).optional(),
  /**
   * 年份半开区间（如 [2021,2022)，更早为 [,2001)），单个参数代替起止两个；
   * 单年选项编码为 [y,y+1)，上界允许到下一年；
   * 注意 zod v4 的 refine 不随 regex 失败短路，需容错解析（parseYearRange）
   */
  year: z
    .string()
    .regex(YEAR_RANGE_RE)
    .refine(val => {
      const { from, to } = parseYearRange(val);
      return !from || !to || from < to;
    })
    .refine(val => {
      const { from, to } = parseYearRange(val);
      const max = new Date().getFullYear() + 1;
      return [from, to].every(v => !v || (v >= 1990 && v <= max));
    })
    .optional(),
  month: codeToValue(MONTH_CODE).optional(),
  tag: IdSchema.optional(),
  sort: codeToValue(SORT_CODE).default('score')
});

export type ClientListQuery = z.infer<typeof ClientListQuerySchema>;
/** 热门列表响应：条目结构与搜索结果一致（无高亮字段） */
export const ClientHotResponseSchema = z.object({
  items: z.array(SearchAnimeItemSchema),
  total: z.number()
});

/** 猜你喜欢 query：随机排序分页，seed 便同一会话内分页顺序稳定 */
export const ClientGuessQuerySchema = z.object({
  ...PaginationQuerySchema,
  seed: z.string().max(64).optional()
});

export type ClientGuessQuery = z.infer<typeof ClientGuessQuerySchema>;
