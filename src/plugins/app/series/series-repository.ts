import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { seriesTable, animeTable } from '../../../db/index.js';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { SeriesListQuery, AddSeriesBody } from '../../../schemas/series.js';
import { escapeLike } from '../../../utils/like.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { t2s } from '../../../utils/t2s.js';

declare module 'fastify' {
  interface FastifyInstance {
    seriesRepository: ReturnType<typeof createSeriesRepository>;
  }
}

const createSeriesRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  return {
    /** 根据 ID 查找 */
    async findById(id: number) {
      const [series] = await db
        .select()
        .from(seriesTable)
        .where(eq(seriesTable.id, id))
        .limit(1);
      return series ?? null;
    },

    /** 根据名称查找 */
    async findByName(name: string) {
      const [series] = await db
        .select()
        .from(seriesTable)
        .where(eq(seriesTable.name, name))
        .limit(1);
      return series ?? null;
    },

    /** 创建系列 */
    async create(series: AddSeriesBody) {
      const [created] = await db.insert(seriesTable).values(series).returning();
      return created;
    },

    /** 查询列表 */
    async findAll(params: SeriesListQuery) {
      const { page, pageSize, keyword, sort, order } = params;

      const whereClause = keyword
        ? like(seriesTable.name, `%${escapeLike(t2s(keyword))}%`)
        : undefined;

      const [series, countResult] = await Promise.all([
        db
          .select({
            id: seriesTable.id,
            name: seriesTable.name,
            createdAt: seriesTable.createdAt
          })
          .from(seriesTable)
          .where(whereClause)
          .orderBy(...buildOrderBy(seriesTable[sort], order, seriesTable.id))
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(seriesTable)
          .where(whereClause)
      ]);

      // 分离查询：批量获取当前页系列下的番剧（一对多，避免 lateral join）
      const seriesIds = series.map(s => s.id);
      const animeRows =
        seriesIds.length > 0
          ? await db
              .select({
                id: animeTable.id,
                name: animeTable.name,
                season: animeTable.season,
                seriesId: animeTable.seriesId
              })
              .from(animeTable)
              .where(inArray(animeTable.seriesId, seriesIds))
          : [];

      const animeBySeries = new Map<number, typeof animeRows>();
      for (const a of animeRows) {
        const list = animeBySeries.get(a.seriesId) ?? [];
        list.push(a);
        animeBySeries.set(a.seriesId, list);
      }

      return {
        items: series.map(s => ({
          ...s,
          anime: animeBySeries.get(s.id) ?? []
        })),
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 删除系列 */
    async deleteById(id: number) {
      const [deleted] = await db
        .delete(seriesTable)
        .where(eq(seriesTable.id, id))
        .returning();
      return deleted ?? null;
    },

    /** 查询选项 */
    async findAllOptions() {
      return db
        .select({
          label: seriesTable.name,
          value: sql<string>`${seriesTable.id}::text`
        })
        .from(seriesTable);
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createSeriesRepository(fastify);
    fastify.decorate('seriesRepository', repo);
  },
  {
    name: 'series-repository',
    dependencies: ['db']
  }
);
