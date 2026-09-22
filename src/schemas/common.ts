import { z } from 'zod';

/**
 * 邮箱 Schema
 */
export const EmailSchema = z.email().min(1).max(255);

/**
 * ID Schema（UUID，各表主键/外键均为 UUIDv7）
 */
export const IdSchema = z.uuid();

/**
 * 成功响应 Schema
 */
export const SuccessResponseSchema = <T extends z.ZodTypeAny>(
  dataSchema?: T
) => {
  const base = z.object({
    code: z.literal(200),
    message: z.string()
  });

  if (dataSchema) {
    return base.extend({ data: dataSchema });
  }
  return base;
};

/**
 * 分页 Schema
 */
export const PaginationQuerySchema = {
  page: z.coerce.number().min(1).optional().default(1),
  pageSize: z.coerce.number().min(1).max(50).optional().default(10)
};

/**
 * 选项 Schema
 */
export const OptionSchemaResponse = z.array(
  z.object({
    label: z.string(),
    value: z.string()
  })
);
