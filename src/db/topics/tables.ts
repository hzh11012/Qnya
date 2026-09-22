import { boolean, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from '../columns.helpers.js';

/** 专题表 */
export const topicsTable = pgTable('topics', {
  /** 专题ID */
  id: idColumn(),
  /** 专题名 */
  name: varchar({ length: 50 }).notNull().unique(),
  /** 专题描述 */
  description: text().notNull(),
  /** 专题状态 */
  status: boolean().notNull().default(false),
  /** 专题封面 */
  cover: varchar({ length: 255 }).notNull(),
  ...timestamps
});
