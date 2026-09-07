import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { videosTable, animeTable } from '../../../db/index.js';
import { and, eq, like, sql } from 'drizzle-orm';
import type {
  VideoListQuery,
  AddVideoBody,
  UpdateVideoBody
} from '../../../schemas/videos.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { escapeLike } from '../../../utils/like.js';
import { t2s } from '../../../utils/t2s.js';

declare module 'fastify' {
  interface FastifyInstance {
    videosRepository: ReturnType<typeof createVideosRepository>;
  }
}

const createVideosRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  return {
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
              name: `${animeName}${animeSeasonName ? ` ${animeSeasonName}` : animeSeason !== 1 ? ` 第${animeSeason}季` : ''}`,
              cover: animeCover
            }
          })
        ),
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 根据 ID 查找视频 */
    async findById(id: number) {
      const [video] = await db
        .select()
        .from(videosTable)
        .where(eq(videosTable.id, id))
        .limit(1);
      return video ?? null;
    },

    /** 根据 animeId 和 episode 查找视频 */
    async findByAnimeIdAndEpisode(animeId: number, episode: number) {
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
    async update(id: number, data: UpdateVideoBody) {
      const [updated] = await db
        .update(videosTable)
        .set(data)
        .where(eq(videosTable.id, id))
        .returning();
      return updated ?? null;
    },

    /** 删除视频 */
    async deleteById(id: number) {
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
