import { z } from 'zod';
import { ArrayQuerySchema, PaginationQuerySchema, IdSchema } from './common.js';

export const WebhookSchema = z.object({
  hash: z.string().min(1),
  tag: z.string().optional(),
  token: z.string().min(1)
});

export type WebhookQuery = z.infer<typeof WebhookSchema>;

const TaskStatus = ['pending', 'completed'] as const;

export const TaskListSchema = z.preprocess(
  val => val ?? {},
  z.object({
    ...PaginationQuerySchema,
    keyword: z.string().max(500).optional(),
    status: ArrayQuerySchema(z.enum(TaskStatus)),
    sort: z.enum(['createdAt', 'fileSize']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc')
  })
);

export type TaskListQuery = z.infer<typeof TaskListSchema>;

export const TaskListSchemaResponse = z.object({
  items: z.array(
    z.object({
      id: IdSchema,
      filename: z.string(),
      fileSize: z.number(),
      status: z.enum(TaskStatus),
      createdAt: z.date()
    })
  ),
  total: z.number()
});

export const DeleteTaskSchema = z.object({
  id: IdSchema
});

export type DeleteTaskBody = z.infer<typeof DeleteTaskSchema>;

export const IngestTaskSchema = z.object({
  id: IdSchema,
  path: z.string().min(1).max(25)
});

export type IngestTaskBody = z.infer<typeof IngestTaskSchema>;
