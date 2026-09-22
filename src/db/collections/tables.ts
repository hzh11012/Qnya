import { index, pgTable, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from '../columns.helpers.js';
import { usersTable } from '../users/index.js';
import { animeTable } from '../anime/index.js';

/** 追番表 */
export const collectionsTable = pgTable(
  'collections',
  {
    /** 收藏ID */
    id: idColumn(),
    /** 用户ID (外键) */
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    /** 动漫ID (外键) */
    animeId: uuid('anime_id')
      .notNull()
      .references(() => animeTable.id, { onDelete: 'cascade' }),
    ...timestamps
  },
  table => [
    unique('collections_user_anime_unique').on(table.userId, table.animeId),
    index('collections_user_id_idx').on(table.userId),
    index('collections_anime_id_idx').on(table.animeId)
  ]
);
