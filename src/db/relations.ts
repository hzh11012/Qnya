import { relations } from 'drizzle-orm';
import { index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './columns.helpers.js';
import { animeTable } from './anime/index.js';
import { tagsTable } from './tags/index.js';
import { seriesTable } from './series/index.js';
import { scoresTable } from './scores/index.js';
import { usersTable } from './users/index.js';
import { topicsTable } from './topics/index.js';
import { collectionsTable } from './collections/index.js';
import { feedbackTable } from './feedback/index.js';
import { videosTable } from './videos/index.js';
import { danmakuTable } from './danmaku/index.js';
import { historiesTable } from './histories/index.js';

// ============================================
// 中间表定义
// ============================================

/** 动漫-分类 多对多中间表 */
export const animeToTagsTable = pgTable(
  'anime_to_tags',
  {
    /** 动漫ID */
    animeId: uuid('anime_id')
      .notNull()
      .references(() => animeTable.id, { onDelete: 'cascade' }),
    /** 分类ID */
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tagsTable.id, { onDelete: 'cascade' }),
    ...timestamps
  },
  table => [
    primaryKey({ columns: [table.animeId, table.tagId] }),
    index('anime_to_tags_anime_id_idx').on(table.animeId),
    index('anime_to_tags_tag_id_idx').on(table.tagId)
  ]
);

/** 动漫-专题 多对多中间表 */
export const animeToTopicsTable = pgTable(
  'anime_to_topics',
  {
    /** 动漫ID */
    animeId: uuid('anime_id')
      .notNull()
      .references(() => animeTable.id, { onDelete: 'cascade' }),
    /** 专题ID */
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topicsTable.id, { onDelete: 'cascade' }),
    ...timestamps
  },
  table => [
    primaryKey({ columns: [table.animeId, table.topicId] }),
    index('anime_to_topics_anime_id_idx').on(table.animeId),
    index('anime_to_topics_topic_id_idx').on(table.topicId)
  ]
);

// ============================================
// 关系定义
// ============================================

/** 动漫表关系 */
export const animeRelations = relations(animeTable, ({ one, many }) => ({
  series: one(seriesTable, {
    fields: [animeTable.seriesId],
    references: [seriesTable.id]
  }),
  tags: many(animeToTagsTable),
  scores: many(scoresTable),
  topics: many(animeToTopicsTable),
  collections: many(collectionsTable),
  feedback: many(feedbackTable),
  videos: many(videosTable)
}));

/** 用户表关系 */
export const usersRelations = relations(usersTable, ({ many }) => ({
  scores: many(scoresTable),
  collections: many(collectionsTable),
  feedback: many(feedbackTable),
  danmaku: many(danmakuTable),
  histories: many(historiesTable)
}));

/** 动漫-分类 多对多关系 */
export const animeToTagsRelations = relations(animeToTagsTable, ({ one }) => ({
  anime: one(animeTable, {
    fields: [animeToTagsTable.animeId],
    references: [animeTable.id]
  }),
  tag: one(tagsTable, {
    fields: [animeToTagsTable.tagId],
    references: [tagsTable.id]
  })
}));

/** 动漫-专题 多对多关系 */
export const animeToTopicsRelations = relations(
  animeToTopicsTable,
  ({ one }) => ({
    anime: one(animeTable, {
      fields: [animeToTopicsTable.animeId],
      references: [animeTable.id]
    }),
    topic: one(topicsTable, {
      fields: [animeToTopicsTable.topicId],
      references: [topicsTable.id]
    })
  })
);

/** 系列表关系 */
export const seriesRelations = relations(seriesTable, ({ many }) => ({
  anime: many(animeTable)
}));

/** 分类表关系 */
export const tagsRelations = relations(tagsTable, ({ many }) => ({
  animeToTags: many(animeToTagsTable)
}));

/** 评分表关系 */
export const scoresRelations = relations(scoresTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [scoresTable.userId],
    references: [usersTable.id]
  }),
  anime: one(animeTable, {
    fields: [scoresTable.animeId],
    references: [animeTable.id]
  })
}));

/** 专题表关系 */
export const topicsRelations = relations(topicsTable, ({ many }) => ({
  animeToTopics: many(animeToTopicsTable)
}));

/** 追番表关系 */
export const collectionsRelations = relations(collectionsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [collectionsTable.userId],
    references: [usersTable.id]
  }),
  anime: one(animeTable, {
    fields: [collectionsTable.animeId],
    references: [animeTable.id]
  })
}));

/** 反馈表关系 */
export const feedbackRelations = relations(feedbackTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [feedbackTable.userId],
    references: [usersTable.id]
  }),
  anime: one(animeTable, {
    fields: [feedbackTable.animeId],
    references: [animeTable.id]
  })
}));

/** 视频表关系 */
export const videosRelations = relations(videosTable, ({ one, many }) => ({
  anime: one(animeTable, {
    fields: [videosTable.animeId],
    references: [animeTable.id]
  }),
  danmaku: many(danmakuTable),
  histories: many(historiesTable)
}));

/** 弹幕表关系 */
export const danmakuRelations = relations(danmakuTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [danmakuTable.userId],
    references: [usersTable.id]
  }),
  video: one(videosTable, {
    fields: [danmakuTable.videoId],
    references: [videosTable.id]
  })
}));

/** 历史记录表关系 */
export const historiesRelations = relations(historiesTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [historiesTable.userId],
    references: [usersTable.id]
  }),
  anime: one(animeTable, {
    fields: [historiesTable.animeId],
    references: [animeTable.id]
  }),
  video: one(videosTable, {
    fields: [historiesTable.videoId],
    references: [videosTable.id]
  })
}));
