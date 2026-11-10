import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * APP 发布平台枚举
 * @enum
 * @member android 安卓
 * @member windows Windows
 * @member ios iOS
 * @member macos macOS
 */
export const appPlatformEnum = pgEnum('app_platform', [
  'android',
  'windows',
  'ios',
  'macos'
]);
