import { pgTable, varchar } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from '../columns.helpers.js';

/** 分类表 */
export const tagsTable = pgTable('tags', {
  /** 分类ID */
  id: idColumn(),
  /** 分类名 */
  name: varchar({ length: 25 }).notNull().unique(),
  ...timestamps
});
