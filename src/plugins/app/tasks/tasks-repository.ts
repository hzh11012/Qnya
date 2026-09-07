import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { tasksTable } from '../../../db/index.js';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { TaskListQuery } from '../../../schemas/webhook.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { t2s } from '../../../utils/t2s.js';
import { escapeLike } from '../../../utils/like.js';

declare module 'fastify' {
  interface FastifyInstance {
    tasksRepository: ReturnType<typeof createTasksRepository>;
  }
}

interface CreateTaskParams {
  torrentHash: string;
  fileIndex: number;
  filename: string;
  filePath: string;
  fileSize: number;
}

const createTasksRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  return {
    /** 根据 ID 查找 */
    async findById(id: number) {
      const [task] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, id))
        .limit(1);
      return task ?? null;
    },

    /** 获取所有文件 */
    async findAll(params: TaskListQuery) {
      const { page, pageSize, keyword, status, sort, order } = params;

      // 构建查询条件
      const conditions = [];

      if (keyword) {
        conditions.push(
          like(tasksTable.filename, `%${escapeLike(t2s(keyword))}%`)
        );
      }

      if (status?.length) {
        conditions.push(inArray(tasksTable.status, status));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // 排序字段映射（加 id 作为次级排序，确保分页稳定）
      const orderByColumn = {
        createdAt: tasksTable.createdAt,
        fileSize: tasksTable.fileSize
      }[sort];

      // 并行查询数据和总数
      const [items, countResult] = await Promise.all([
        db
          .select()
          .from(tasksTable)
          .where(whereClause)
          .orderBy(...buildOrderBy(orderByColumn, order, tasksTable.id))
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(tasksTable)
          .where(whereClause)
      ]);

      return {
        items,
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 根据种子 hash 获取所有文件 */
    async findByTorrentHash(torrentHash: string) {
      return db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.torrentHash, torrentHash));
    },

    /** 批量创建 */
    async createMany(files: CreateTaskParams[]) {
      if (files.length === 0) return [];
      return db.insert(tasksTable).values(files).returning();
    },

    /** 标记已成功 */
    async markCompleted(id: number) {
      const [updated] = await db
        .update(tasksTable)
        .set({ status: 'completed' })
        .where(eq(tasksTable.id, id))
        .returning();
      return updated ?? null;
    },

    /** 删除单个记录 */
    async deleteById(id: number) {
      const [deleted] = await db
        .delete(tasksTable)
        .where(eq(tasksTable.id, id))
        .returning();
      return deleted ?? null;
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createTasksRepository(fastify);
    fastify.decorate('tasksRepository', repo);
  },
  {
    name: 'tasks-repository',
    dependencies: ['db']
  }
);
