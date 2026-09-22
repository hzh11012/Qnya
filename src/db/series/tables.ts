import { pgTable, varchar } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from '../columns.helpers.js';

/** 系列表 */
export const seriesTable = pgTable('series', {
  /** 系列ID */
  id: idColumn(),
  /** 系列名 */
  name: varchar({ length: 100 }).notNull().unique(),
  ...timestamps
});
