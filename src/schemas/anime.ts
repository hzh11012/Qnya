import { z } from 'zod';
import { IdSchema, PaginationQuerySchema, ArrayQuerySchema } from './common.js';

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
