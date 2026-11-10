import { z } from 'zod';
import { IdSchema, PaginationQuerySchema } from './common.js';

/** APP 发布平台 */
export const AppPlatformSchema = z.enum(['android', 'windows', 'ios', 'macos']);
export type AppPlatform = z.infer<typeof AppPlatformSchema>;

/** 客户端 — 最新版本信息（GET /api/app/latest 的 data） */
export const LatestReleaseSchema = z.object({
  /** 版本号（服务端自动维护的存档序号，客户端不参与更新判断） */
  versionCode: z.number().int().min(0).nullable(),
  /** 展示版本名（如 2.0.15），客户端逐段数值比较判断是否更新 */
  versionName: z.string().max(32),
  /** 安装包下载地址（任意可直接访问的 URL） */
  url: z.string().max(500),
  /** 更新日志 */
  changelog: z.string().max(2000)
});

/** 客户端 — 最新版本查询（按平台取最新一条） */
export const LatestReleaseQuerySchema = z.object({
  platform: AppPlatformSchema.default('android')
});
export type LatestReleaseQuery = z.infer<typeof LatestReleaseQuerySchema>;

/** 后台 — 版本发布列表查询 */
export const AppReleaseListSchema = z.preprocess(
  val => val ?? {},
  z.object({
    ...PaginationQuerySchema,
    platform: AppPlatformSchema.optional(),
    sort: z.enum(['createdAt']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc')
  })
);

export type AppReleaseListQuery = z.infer<typeof AppReleaseListSchema>;

/**
 * 后台 — 发布新版本（body）。
 * 只填版本名（如 2.0.15）；versionCode 由服务端自动递增维护，仅作存档。
 */
export const CreateAppReleaseBodySchema = z.object({
  versionName: z.string().min(1, '版本号不能为空').max(32, '版本号最多 32 字'),
  platform: AppPlatformSchema.default('android'),
  url: z.string().min(1, '下载地址不能为空').max(500, '下载地址最多 500 字'),
  changelog: z.string().max(2000, '更新日志最多 2000 字').default('')
});

export type CreateAppReleaseBody = z.infer<typeof CreateAppReleaseBodySchema>;

/** 后台 — 修改版本发布（body，编辑表单整表提交） */
export const UpdateAppReleaseBodySchema = z.object({
  versionName: z.string().min(1, '版本号不能为空').max(32, '版本号最多 32 字'),
  platform: AppPlatformSchema,
  url: z.string().min(1, '下载地址不能为空').max(500, '下载地址最多 500 字'),
  changelog: z.string().max(2000, '更新日志最多 2000 字').default('')
});

export type UpdateAppReleaseBody = z.infer<typeof UpdateAppReleaseBodySchema>;

/** 后台 — 版本发布行（列表响应） */
export const AppReleaseRowSchema = z.object({
  id: IdSchema,
  versionCode: z.number().int().nullable(),
  versionName: z.string(),
  platform: AppPlatformSchema,
  url: z.string(),
  changelog: z.string(),
  createdAt: z.date()
});

export const AppReleaseListSchemaResponse = z.object({
  items: z.array(AppReleaseRowSchema),
  total: z.number().int()
});

/** 后台 — 版本发布路径参数 */
export const AppReleaseIdParamsSchema = z.object({
  id: IdSchema
});

export type AppReleaseIdParams = z.infer<typeof AppReleaseIdParamsSchema>;
