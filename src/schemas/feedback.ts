import { z } from 'zod';
import { IdSchema, PaginationQuerySchema, ArrayQuerySchema } from './common.js';

export const FeedbackListSchema = z.preprocess(
  val => val ?? {},
  z.object({
    ...PaginationQuerySchema,
    keyword: z.string().optional(),
    type: ArrayQuerySchema(
      z.enum(['consultation', 'suggestion', 'complaint', 'other'])
    ),
    status: ArrayQuerySchema(z.enum(['pending', 'processing', 'done'])),
    sort: z.enum(['createdAt']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc')
  })
);

export type FeedbackListQuery = z.infer<typeof FeedbackListSchema>;

export const UpdateFeedbackParamsSchema = z.object({
  id: IdSchema
});

export type UpdateFeedbackParams = z.infer<typeof UpdateFeedbackParamsSchema>;

export const UpdateFeedbackBodySchema = z.object({
  type: z.enum(['consultation', 'suggestion', 'complaint', 'other']).optional(),
  content: z.string().min(1).optional(),
  status: z.enum(['pending', 'processing', 'done']).optional()
});

export type UpdateFeedbackBody = z.infer<typeof UpdateFeedbackBodySchema>;

/** 客户端 — 提交问题反馈 */
export const ClientFeedbackCreateParamsSchema = z.object({
  animeId: IdSchema
});

export const ClientFeedbackCreateBodySchema = z.object({
  type: z.enum(['consultation', 'suggestion', 'complaint', 'other']),
  content: z.string().min(1, '反馈内容不能为空').max(500, '反馈内容最多 500 字')
});

export type ClientFeedbackCreateParams = z.infer<
  typeof ClientFeedbackCreateParamsSchema
>;
export type ClientFeedbackCreateBody = z.infer<
  typeof ClientFeedbackCreateBodySchema
>;

export const DeleteFeedbackParamsSchema = z.object({
  id: IdSchema
});

export type DeleteFeedbackParams = z.infer<typeof DeleteFeedbackParamsSchema>;

export const FeedbackListSchemaResponse = z.object({
  items: z.array(
    z.object({
      id: IdSchema,
      userId: IdSchema,
      animeId: IdSchema,
      anime: z.object({
        name: z.string(),
        cover: z.string()
      }),
      user: z.object({ name: z.string() }),
      type: z.enum(['consultation', 'suggestion', 'complaint', 'other']),
      content: z.string(),
      status: z.enum(['pending', 'processing', 'done']),
      createdAt: z.date()
    })
  ),
  total: z.number()
});
