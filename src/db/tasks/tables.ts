import { bigint, index, integer, pgTable, varchar } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from '../columns.helpers.js';
import { taskStatusEnum } from './enum.js';

/** 任务表 */
export const tasksTable = pgTable(
  'tasks',
  {
    id: idColumn(),

    // === qBit 信息 ===
    /** 种子hash */
    torrentHash: varchar('torrent_hash', { length: 64 }).notNull(),
    /** 文件在种子中的索引 */
    fileIndex: integer('file_index').notNull(),

    // === 文件信息 ===
    /** 文件名 */
    filename: varchar('filename', { length: 500 }).notNull(),
    /** 下载后的完整路径 */
    filePath: varchar('file_path', { length: 1000 }).notNull(),
    /** 文件大小 (字节) */
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),

    // === 状态信息 ===
    /** 任务状态 */
    status: taskStatusEnum().notNull().default('pending'),

    ...timestamps
  },
  table => [
    index('tasks_status_idx').on(table.status),
    index('tasks_torrent_hash_idx').on(table.torrentHash)
  ]
);
