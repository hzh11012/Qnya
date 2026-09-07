import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { collectionsTable, usersTable, animeTable } from '../../../db/index.js';
import { eq, inArray, like, sql } from 'drizzle-orm';
import type { CollectionListQuery } from '../../../schemas/collections.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { escapeLike } from '../../../utils/like.js';
import { t2s } from '../../../utils/t2s.js';

declare module 'fastify' {
  interface FastifyInstance {
    collectionsRepository: ReturnType<typeof createCollectionsRepository>;
  }
}

const createCollectionsRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  return {
    /** 查询追番列表 */
    async findAll(params: CollectionListQuery) {
      const { page, pageSize, sort, order, keyword } = params;

      const whereClause = keyword
        ? inArray(
            collectionsTable.userId,
            db
              .select({ id: usersTable.id })
              .from(usersTable)
              .where(like(usersTable.name, `%${escapeLike(t2s(keyword))}%`))
          )
        : undefined;

      const [items, countResult] = await Promise.all([
        db
          .select({
            id: collectionsTable.id,
            userId: collectionsTable.userId,
            animeId: collectionsTable.animeId,
            createdAt: collectionsTable.createdAt,
            userName: usersTable.name,
            animeName: animeTable.name,
            animeSeason: animeTable.season,
            animeSeasonName: animeTable.seasonName,
            animeCover: animeTable.cover
          })
          .from(collectionsTable)
          .leftJoin(usersTable, eq(collectionsTable.userId, usersTable.id))
          .leftJoin(animeTable, eq(collectionsTable.animeId, animeTable.id))
          .where(whereClause)
          .orderBy(
            ...buildOrderBy(collectionsTable[sort], order, collectionsTable.id)
          )
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(collectionsTable)
          .where(whereClause)
      ]);

      return {
        items: items.map(
          ({
            userName,
            animeName,
            animeSeason,
            animeSeasonName,
            animeCover,
            ...rest
          }) => ({
            ...rest,
            user: { name: userName },
            anime: {
              name: `${animeName}${animeSeasonName ? ` ${animeSeasonName}` : animeSeason !== 1 ? ` 第${animeSeason}季` : ''}`,
              cover: animeCover
            }
          })
        ),
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 删除追番 */
    async deleteById(id: number) {
      const [deleted] = await db
        .delete(collectionsTable)
        .where(eq(collectionsTable.id, id))
        .returning();
      return deleted ?? null;
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createCollectionsRepository(fastify);
    fastify.decorate('collectionsRepository', repo);
  },
  {
    name: 'collections-repository',
    dependencies: ['db']
  }
);
