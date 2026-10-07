import { z } from 'zod';
import { ArrayQuerySchema, IdSchema, PaginationQuerySchema } from './common.js';

export const ScoreListSchema = z.preprocess(
  val => val ?? {},
  z.object({
    ...PaginationQuerySchema,
    keyword: z.string().optional(),
    status: ArrayQuerySchema(
      z.enum(['true', 'false']).transform(val => val === 'true')
    ),
    sort: z.enum(['createdAt']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc')
  })
);

export type ScoreListQuery = z.infer<typeof ScoreListSchema>;

export const DeleteScoreParamsSchema = z.object({
  id: IdSchema
});

export type DeleteScoreParams = z.infer<typeof DeleteScoreParamsSchema>;

export const UpdateScoreParamsSchema = z.object({
  id: IdSchema
});

export type UpdateScoreParams = z.infer<typeof UpdateScoreParamsSchema>;

export const UpdateScoreBodySchema = z.object({
  status: z.boolean()
});

export type UpdateScoreBody = z.infer<typeof UpdateScoreBodySchema>;

export const ScoreListSchemaResponse = z.object({
  items: z.array(
    z.object({
      id: IdSchema,
      userId: IdSchema,
      animeId: IdSchema,
      score: z.number(),
      content: z.string(),
      status: z.boolean(),
      user: z.object({
        name: z.string()
      }),
      anime: z.object({
        name: z.string(),
        cover: z.string()
      }),
      createdAt: z.date()
    })
  ),
  total: z.number()
});
