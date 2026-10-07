import { z } from 'zod';
import { ArrayQuerySchema, PaginationQuerySchema, IdSchema } from './common.js';

const UserRole = ['admin', 'premium', 'user', 'guest'] as const;

export const UserListSchema = z.preprocess(
  val => val ?? {},
  z.object({
    ...PaginationQuerySchema,
    keyword: z.string().max(500).optional(),
    role: ArrayQuerySchema(z.enum(UserRole)),
    status: z
      .array(z.enum(['true', 'false']).transform(val => val === 'true'))
      .optional(),
    sort: z.enum(['createdAt']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc')
  })
);

export type UserListQuery = z.infer<typeof UserListSchema>;

export const UpdateUserParamsSchema = z.object({
  id: IdSchema
});

export type UpdateUserParams = z.infer<typeof UpdateUserParamsSchema>;

export const UpdateUserBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  role: z.enum(UserRole).optional(),
  status: z.boolean().optional(),
  avatar: z.string().nullish()
});

export type UpdateUserBody = z.infer<typeof UpdateUserBodySchema>;

export const UserListSchemaResponse = z.object({
  items: z.array(
    z.object({
      id: IdSchema,
      name: z.string(),
      email: z.string(),
      role: z.enum(UserRole),
      status: z.boolean(),
      avatar: z.string().nullish(),
      createdAt: z.date()
    })
  ),
  total: z.number()
});
