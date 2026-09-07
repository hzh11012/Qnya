import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  historiesTable,
  usersTable,
  videosTable,
  animeTable
} from '../../../db/index.js';
import { eq, sql, and, inArray, like } from 'drizzle-orm';
import type { HistoryListQuery } from '../../../schemas/histories.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { escapeLike } from '../../../utils/like.js';
import { t2s } from '../../../utils/t2s.js';

declare module 'fastify' {
  interface FastifyInstance {
    historiesRepository: ReturnType<typeof createHistoriesRepository>;
  }
}

const createHistoriesRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  return {
    /** 查询观看记录列表 */
    async findAll(params: HistoryListQuery) {
      const { page, pageSize, sort, order, keyword } = params;

      const whereClause = keyword
        ? inArray(
            historiesTable.userId,
            db
              .select({ id: usersTable.id })
              .from(usersTable)
              .where(like(usersTable.name, `%${escapeLike(t2s(keyword))}%`))
          )
        : undefined;

      const [items, countResult] = await Promise.all([
        db
          .select({
            id: historiesTable.id,
            time: historiesTable.time,
            createdAt: historiesTable.createdAt,
            userName: usersTable.name,
            videoEpisode: videosTable.episode,
            animeName: animeTable.name,
            animeSeason: animeTable.season,
            animeSeasonName: animeTable.seasonName,
            animeCover: animeTable.cover
          })
          .from(historiesTable)
          .leftJoin(usersTable, eq(historiesTable.userId, usersTable.id))
          .leftJoin(videosTable, eq(historiesTable.videoId, videosTable.id))
          .leftJoin(animeTable, eq(videosTable.animeId, animeTable.id))
          .where(whereClause)
          .orderBy(
            ...buildOrderBy(historiesTable[sort], order, historiesTable.id)
          )
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(historiesTable)
          .where(whereClause)
      ]);

      return {
        items: items.map(
          ({
            userName,
            videoEpisode,
            animeName,
            animeSeason,
            animeSeasonName,
            animeCover,
            ...rest
          }) => ({
            ...rest,
            user: { name: userName },
            anime: {
              name: `${animeName}${animeSeasonName ? ` ${animeSeasonName}` : animeSeason !== 1 ? ` 第${animeSeason}季` : ''} (第${videoEpisode}集)`,
              cover: animeCover
            }
          })
        ),
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 根据 ID 查找观看记录 */
    async findById(id: number) {
      const [history] = await db
        .select()
        .from(historiesTable)
        .where(eq(historiesTable.id, id))
        .limit(1);
      return history ?? null;
    },

    /** 根据 userId 和 videoId 查找观看记录 */
    async findByUserIdAndVideoId(userId: number, videoId: number) {
      const [history] = await db
        .select()
        .from(historiesTable)
        .where(
          and(
            eq(historiesTable.userId, userId),
            eq(historiesTable.videoId, videoId)
          )
        )
        .limit(1);
      return history ?? null;
    },

    /** 删除观看记录 */
    async deleteById(id: number) {
      const [deleted] = await db
        .delete(historiesTable)
        .where(eq(historiesTable.id, id))
        .returning();
      return deleted ?? null;
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createHistoriesRepository(fastify);
    fastify.decorate('historiesRepository', repo);
  },
  {
    name: 'histories-repository',
    dependencies: ['db']
  }
);
