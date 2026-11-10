import { index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from '../columns.helpers.js';
import { appPlatformEnum } from './enums.js';

/** 移动端 APP 版本发布表（应用内 OTA 自更新） */
export const appReleasesTable = pgTable(
  'app_releases',
  {
    /** 发布ID */
    id: idColumn(),
    /** 版本号（服务端自动递增的存档序号，不参与客户端更新判断） */
    versionCode: integer('version_code'),
    /** 展示版本名（如 2.0.15） */
    versionName: text('version_name').notNull(),
    /** 目标平台 */
    platform: appPlatformEnum().notNull().default('android'),
    /** 安装包下载地址（任意可直接访问的 URL） */
    url: text('url').notNull(),
    /** 更新日志 */
    changelog: text('changelog').notNull().default(''),
    ...timestamps
  },
  table => [index('app_releases_version_code_idx').on(table.versionCode)]
);
