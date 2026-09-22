import { index, text, boolean, pgTable, varchar } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from '../columns.helpers.js';
import { userRoleEnum } from './enums.js';

/** 用户表 */
export const usersTable = pgTable(
  'users',
  {
    id: idColumn(),
    name: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    role: userRoleEnum().notNull().default('guest'),
    status: boolean().notNull().default(true),
    avatar: text(),
    ...timestamps
  },
  table => [
    index('users_name_idx').on(table.name),
    index('users_status_role_idx').on(table.status, table.role)
  ]
);
