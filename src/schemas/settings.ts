import { z } from 'zod';

export const SettingsInfoSchemaResponse = z.object({
  /** 服务器信息 */
  server: z.object({
    nodeVersion: z.string(),
    environment: z.string(),
    uptime: z.number(),
    port: z.number(),
    adminEmail: z.string()
  }),
  /** qBittorrent 信息 */
  qbit: z.object({
    host: z.string(),
    downloadPath: z.string(),
    hostDownloadPath: z.string()
  }),
  /** SMTP 信息 */
  smtp: z.object({
    host: z.string(),
    port: z.number(),
    secure: z.boolean(),
    from: z.string()
  }),
  /** 数据库连接池信息 */
  database: z.object({
    poolMax: z.number(),
    poolIdleTimeout: z.number(),
    poolConnectionTimeout: z.number()
  }),
  /** Session 信息 */
  session: z.object({
    maxAge: z.number(),
    renewThreshold: z.number(),
    domain: z.string()
  }),
  /** 安全配置 */
  security: z.object({
    rateLimitMax: z.number(),
    corsOrigins: z.string()
  }),
  /** 资源路径配置 */
  resource: z.object({
    rootPath: z.string()
  }),
  /** TMDB 配置 */
  tmdb: z.object({
    imageDomain: z.string(),
    apiDomain: z.string()
  }),
  /** Meilisearch 搜索服务 */
  meilisearch: z.object({
    host: z.string(),
    status: z.enum(['ok', 'error']),
    documents: z.number(),
    inSync: z.boolean()
  })
});

export type SettingsInfoResponse = z.infer<typeof SettingsInfoSchemaResponse>;
