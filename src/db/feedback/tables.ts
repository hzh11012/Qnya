import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from '../columns.helpers.js';
import { usersTable } from '../users/index.js';
import { animeTable } from '../anime/index.js';
import { feedbackTypeEnum, feedbackStatusEnum } from './enums.js';

/** 反馈表 */
export const feedbackTable = pgTable(
  'feedback',
  {
    /** 反馈ID */
    id: idColumn(),
    /** 用户ID (外键) */
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    /** 动漫ID (外键) */
    animeId: uuid('anime_id')
      .notNull()
      .references(() => animeTable.id, { onDelete: 'cascade' }),
    /** 反馈类型 */
    type: feedbackTypeEnum().notNull(),
    /** 反馈内容 */
    content: text().notNull(),
    /** 反馈状态 */
    status: feedbackStatusEnum().notNull().default('pending'),
    ...timestamps
  },
  table => [
    index('feedback_user_id_idx').on(table.userId),
    index('feedback_anime_id_idx').on(table.animeId),
    index('feedback_status_idx').on(table.status, table.type)
  ]
);
