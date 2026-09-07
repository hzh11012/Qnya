import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  danmakuTable,
  usersTable,
  videosTable,
  animeTable
} from '../../../db/index.js';
import { and, eq, like, sql } from 'drizzle-orm';
import type { DanmakuListQuery } from '../../../schemas/danmaku.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { escapeLike } from '../../../utils/like.js';
import { t2s } from '../../../utils/t2s.js';

declare module 'fastify' {
  interface FastifyInstance {
    danmakuRepository: ReturnType<typeof createDanmakuRepository>;
  }
}

const createDanmakuRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  return {
    /** 查询弹幕列表 */
    async findAll(params: DanmakuListQuery) {
      const { page, pageSize, sort, order, keyword, mode } = params;

      const conditions = [];

      if (keyword) {
        conditions.push(
          like(danmakuTable.text, `%${escapeLike(t2s(keyword))}%`)
        );
      }

      if (mode) {
        conditions.push(eq(danmakuTable.mode, mode));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const [items, countResult] = await Promise.all([
        db
          .select({
            id: danmakuTable.id,
            text: danmakuTable.text,
            mode: danmakuTable.mode,
            color: danmakuTable.color,
            time: danmakuTable.time,
            createdAt: danmakuTable.createdAt,
            userName: usersTable.name,
            videoEpisode: videosTable.episode,
            animeName: animeTable.name,
            animeSeason: animeTable.season,
            animeSeasonName: animeTable.seasonName,
            animeCover: animeTable.cover
          })
          .from(danmakuTable)
          .leftJoin(usersTable, eq(danmakuTable.userId, usersTable.id))
          .leftJoin(videosTable, eq(danmakuTable.videoId, videosTable.id))
          .leftJoin(animeTable, eq(videosTable.animeId, animeTable.id))
          .where(whereClause)
          .orderBy(...buildOrderBy(danmakuTable[sort], order, danmakuTable.id))
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(danmakuTable)
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

    /** 根据ID查询弹幕 */
    async findById(id: number) {
      const [danmaku] = await db
        .select()
        .from(danmakuTable)
        .where(eq(danmakuTable.id, id))
        .limit(1);
      return danmaku ?? null;
    },

    /** 删除弹幕 */
    async deleteById(id: number) {
      const [deleted] = await db
        .delete(danmakuTable)
        .where(eq(danmakuTable.id, id))
        .returning();
      return deleted ?? null;
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createDanmakuRepository(fastify);
    fastify.decorate('danmakuRepository', repo);
  },
  {
    name: 'danmaku-repository',
    dependencies: ['db']
  }
);
