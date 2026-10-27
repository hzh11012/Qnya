import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { scoresTable, usersTable, animeTable } from '../../../db/index.js';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import type {
  ScoreListQuery,
  UpdateScoreBody
} from '../../../schemas/scores.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { escapeLike } from '../../../utils/like.js';
import { t2s } from '../../../utils/t2s.js';
import { invalidateDashboardCache } from '../dashboard/dashboard-repository.js';
import { syncAnimeScore } from './sync-anime-score.js';

declare module 'fastify' {
  interface FastifyInstance {
    scoresRepository: ReturnType<typeof createScoresRepository>;
  }
}

const createScoresRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  return {
    /** 查询评分列表 */
    async findAll(params: ScoreListQuery) {
      const { page, pageSize, sort, order, keyword, status } = params;

      const conditions = [];

      if (keyword) {
        conditions.push(
          inArray(
            scoresTable.userId,
            db
              .select({ id: usersTable.id })
              .from(usersTable)
              .where(like(usersTable.name, `%${escapeLike(t2s(keyword))}%`))
          )
        );
      }

      if (status && status.length > 0) {
        conditions.push(inArray(scoresTable.status, status));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const [items, countResult] = await Promise.all([
        db
          .select({
            id: scoresTable.id,
            userId: scoresTable.userId,
            animeId: scoresTable.animeId,
            score: scoresTable.score,
            content: scoresTable.content,
            status: scoresTable.status,
            createdAt: scoresTable.createdAt,
            userName: usersTable.name,
            animeName: animeTable.name,
            animeCover: animeTable.cover
          })
          .from(scoresTable)
          .leftJoin(usersTable, eq(scoresTable.userId, usersTable.id))
          .leftJoin(animeTable, eq(scoresTable.animeId, animeTable.id))
          .where(whereClause)
          .orderBy(...buildOrderBy(scoresTable[sort], order, scoresTable.id))
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(scoresTable)
          .where(whereClause)
      ]);

      return {
        items: items.map(({ userName, animeName, animeCover, ...rest }) => ({
          ...rest,
          user: { name: userName },
          anime: { name: animeName, cover: animeCover }
        })),
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 根据ID查询评分 */
    async findById(id: string) {
      const [score] = await db
        .select()
        .from(scoresTable)
        .where(eq(scoresTable.id, id))
        .limit(1);
      return score ?? null;
    },

    /** 更新评分（字段已由 Zod Schema 白名单过滤） */
    async update(id: string, data: UpdateScoreBody) {
      // 评分写入与统计重算同事务（硬性约定 #6）
      const updated = await db.transaction(async tx => {
        const [row] = await tx
          .update(scoresTable)
          .set(data)
          .where(eq(scoresTable.id, id))
          .returning();
        if (!row) return null;
        await syncAnimeScore(tx, row.animeId);
        return row;
      });
      if (updated) {
        // 审核状态变更后立即失效概览统计缓存，避免“待审核”陈旧显示
        await invalidateDashboardCache(fastify.redis);
      }
      return updated;
    },

    /** 删除评分 */
    async deleteById(id: string) {
      // 删除与统计重算同事务（硬性约定 #6）
      const deleted = await db.transaction(async tx => {
        const [row] = await tx
          .delete(scoresTable)
          .where(eq(scoresTable.id, id))
          .returning();
        if (!row) return null;
        await syncAnimeScore(tx, row.animeId);
        return row;
      });
      if (deleted) {
        await invalidateDashboardCache(fastify.redis);
      }
      return deleted;
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createScoresRepository(fastify);
    fastify.decorate('scoresRepository', repo);
  },
  {
    name: 'scores-repository',
    dependencies: ['db']
  }
);
