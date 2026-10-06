import { z } from 'zod';
import { IdSchema, PaginationQuerySchema } from './common.js';

export const TopicListSchema = z.preprocess(
  val => val ?? {},
  z.object({
    ...PaginationQuerySchema,
    keyword: z.string().optional(),
    status: z
      .array(z.enum(['true', 'false']).transform(val => val === 'true'))
      .optional(),
    sort: z.enum(['createdAt']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc')
  })
);

export type TopicListQuery = z.infer<typeof TopicListSchema>;

export const AddTopicSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().min(1),
  status: z.boolean(),
  cover: z.string().min(1).max(255),
  animeIds: z.array(IdSchema).optional()
});

export type AddTopicBody = z.infer<typeof AddTopicSchema>;

export const UpdateTopicParamsSchema = z.object({
  id: IdSchema
});

export type UpdateTopicParams = z.infer<typeof UpdateTopicParamsSchema>;

export const UpdateTopicBodySchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().min(1).optional(),
  status: z.boolean().optional(),
  cover: z.string().min(1).max(255).optional(),
  animeIds: z.array(IdSchema).optional()
});

export type UpdateTopicBody = z.infer<typeof UpdateTopicBodySchema>;

export const DeleteTopicParamsSchema = z.object({
  id: IdSchema
});

export type DeleteTopicParams = z.infer<typeof DeleteTopicParamsSchema>;

export const TopicListSchemaResponse = z.object({
  items: z.array(
    z.object({
      id: IdSchema,
      name: z.string(),
      description: z.string(),
      status: z.boolean(),
      cover: z.string(),
      anime: z.array(
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

// ============================================
// 客户端专题接口
// ============================================

export const ClientTopicListQuerySchema = z.object({
  ...PaginationQuerySchema
});

export type ClientTopicListQuery = z.infer<typeof ClientTopicListQuerySchema>;

export const ClientTopicListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: IdSchema,
      name: z.string(),
      description: z.string(),
      cover: z.string(),
      animeCount: z.number()
    })
  ),
  total: z.number()
});

export const ClientTopicDetailParamsSchema = z.object({
  id: IdSchema
});

export type ClientTopicDetailParams = z.infer<
  typeof ClientTopicDetailParamsSchema
>;

export const ClientTopicDetailResponseSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string(),
  cover: z.string(),
  anime: z.array(
    z.object({
      id: IdSchema,
      name: z.string(),
      description: z.string(),
      cover: z.string(),
      status: z.string(),
      type: z.string(),
      director: z.string(),
      cv: z.string(),
      year: z.number(),
      month: z.string(),
      tags: z.array(z.string()),
      avgScore: z.number(),
      scoreCount: z.number(),
      videoCount: z.number(),
      videoId: IdSchema.nullable(),
      videos: z.array(z.object({ id: IdSchema, episode: z.number() }))
    })
  )
});
