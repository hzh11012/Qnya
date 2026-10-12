import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { videosTable, animeTable } from '../../../db/index.js';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import type {
  VideoListQuery,
  AddVideoBody,
  UpdateVideoBody
} from '../../../schemas/videos.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { escapeLike } from '../../../utils/like.js';
import { buildSeasonSuffix } from '../../../utils/season.js';
import { t2s } from '../../../utils/t2s.js';

declare module 'fastify' {
  interface FastifyInstance {
    videosRepository: ReturnType<typeof createVideosRepository>;
  }
}

const createVideosRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  return {
    /**
     * 按番剧批量统计视频：集数 / 首集 id（episode 升序）/ 总播放量。
     * 客户端各列表的唯一视频统计来源，避免各仓各查一遍 videos 表
     */
    async batchStats(animeIds: string[]) {
      const map = new Map<
        string,
        { count: number; firstId: string | null; playCount: number }
      >();
      if (animeIds.length === 0) return map;

      const rows = await db
        .select({
          animeId: videosTable.animeId,
          count: sql<number>`count(*)::int`,
          firstId: sql<
            string | null
          >`(array_agg(${videosTable.id} order by ${videosTable.episode} asc))[1]`,
          playCount: sql<number>`coalesce(sum(${videosTable.views}), 0)::int`
        })
        .from(videosTable)
        .where(inArray(videosTable.animeId, animeIds))
        .groupBy(videosTable.animeId);
      for (const r of rows) {
        map.set(r.animeId, {
          count: Number(r.count),
          firstId: r.firstId,
          playCount: Number(r.playCount)
        });
      }
      return map;
    },

    /** 查询视频列表 */
    async findAll(params: VideoListQuery) {
      const { page, pageSize, sort, order, keyword } = params;

      // 构建查询条件
      const conditions = [];

      if (keyword) {
        conditions.push(
          like(videosTable.title, `%${escapeLike(t2s(keyword))}%`)
        );
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const [items, countResult] = await Promise.all([
        db
          .select({
            id: videosTable.id,
            animeId: videosTable.animeId,
            title: videosTable.title,
            episode: videosTable.episode,
            url: videosTable.url,
            views: videosTable.views,
            createdAt: videosTable.createdAt,
            animeName: animeTable.name,
            animeSeason: animeTable.season,
            animeSeasonName: animeTable.seasonName,
            animeCover: animeTable.cover
          })
          .from(videosTable)
          .leftJoin(animeTable, eq(videosTable.animeId, animeTable.id))
          .where(whereClause)
          .orderBy(...buildOrderBy(videosTable[sort], order, videosTable.id))
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(videosTable)
          .where(whereClause)
      ]);

      return {
        items: items.map(
          ({
            animeName,
            animeSeason,
            animeSeasonName,
            animeCover,
            ...rest
          }) => ({
            ...rest,
            anime: {
              name: `${animeName}${buildSeasonSuffix(animeSeason, animeSeasonName)}`,
              cover: animeCover
            }
          })
        ),
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 根据 ID 查找视频 */
    async findById(id: string) {
      const [video] = await db
        .select()
        .from(videosTable)
        .where(eq(videosTable.id, id))
        .limit(1);
      return video ?? null;
    },

    /** 根据 animeId 和 episode 查找视频 */
    async findByAnimeIdAndEpisode(animeId: string, episode: number) {
      const [video] = await db
        .select()
        .from(videosTable)
        .where(
          and(
            eq(videosTable.animeId, animeId),
            eq(videosTable.episode, episode)
          )
        )
        .limit(1);
      return video ?? null;
    },

    /** 创建视频 */
    async create(data: AddVideoBody) {
      const [created] = await db.insert(videosTable).values(data).returning();
      return created;
    },

    /** 更新视频 */
    async update(id: string, data: UpdateVideoBody) {
      const [updated] = await db
        .update(videosTable)
        .set(data)
        .where(eq(videosTable.id, id))
        .returning();
      return updated ?? null;
    },

    /** 删除视频 */
    async deleteById(id: string) {
      const [deleted] = await db
        .delete(videosTable)
        .where(eq(videosTable.id, id))
        .returning();
      return deleted ?? null;
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createVideosRepository(fastify);
    fastify.decorate('videosRepository', repo);
  },
  {
    name: 'videos-repository',
    dependencies: ['db']
  }
);
