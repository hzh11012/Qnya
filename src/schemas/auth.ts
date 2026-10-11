import { z } from 'zod';
import { EmailSchema, IdSchema } from './common.js';

export const SendCodeSchema = z.object({
  email: EmailSchema
});

export type SendCodeBody = z.infer<typeof SendCodeSchema>;

export const LoginSchema = z.object({
  email: EmailSchema,
  code: z.string().length(6).regex(/^\d+$/)
});

export const UserInfoSchema = z.object({
  id: IdSchema,
  email: EmailSchema,
  name: z.string(),
  role: z.enum(['admin', 'premium', 'user', 'guest']),
  avatar: z.string().nullable(),
  /** r18 内容访问权限（adult 类型推荐仅对该用户可见） */
  r18: z.boolean()
});

/** 更新个人资料：avatar 为压缩后的 base64 dataURL 或 null（清除头像） */
export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(30).optional(),
  avatar: z.string().max(100_000).nullish()
});

export type UpdateProfileBody = z.infer<typeof UpdateProfileSchema>;

export type LoginBody = z.infer<typeof LoginSchema>;
