import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  animeTable,
  collectionsTable,
  historiesTable,
  videosTable
} from '../../../db/index.js';
import { buildSeasonSuffix } from '../../../utils/season.js';
import type { AnimeType } from '../../../db/anime/enums.js';

declare module 'fastify' {
  interface FastifyInstance {
    homeRepository: ReturnType<typeof createHomeRepository>;
  }
}

/** 首页每类推荐的展示数量 */
const TYPE_ROW_LIMIT = 7;
/** 我的追番在首页的展示数量 */
const COLLECTION_LIMIT = 5;

const createHomeRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  /** 批量统计番剧集数 + 第一集 id（episode 升序） */
  async function findVideoStats(animeIds: string[]) {
    const map = new Map<string, { count: number; firstId: string | null }>();
    if (animeIds.length === 0) return map;

    const videoRows = await db
      .select({ animeId: videosTable.animeId, id: videosTable.id })
      .from(videosTable)
      .where(inArray(videosTable.animeId, animeIds))
      .orderBy(asc(videosTable.animeId), asc(videosTable.episode));
    for (const v of videoRows) {
      const entry = map.get(v.animeId);
      if (entry) {
        entry.count += 1;
      } else {
        map.set(v.animeId, { count: 1, firstId: v.id });
      }
    }
    return map;
  }

  return {
    /** 我的追番（最新收藏的前 COLLECTION_LIMIT 部，带观看进度） */
    async findCollections(userId: string) {
      const rows = await db
        .select({
          animeId: animeTable.id,
          name: animeTable.name,
          season: animeTable.season,
          seasonName: animeTable.seasonName,
          cover: animeTable.cover,
          remark: animeTable.remark,
          status: animeTable.status,
          // 观看进度：历史记录是番剧维度（每番至多一条）
          watchedVideoId: historiesTable.videoId,
          watchedEpisode: videosTable.episode,
          time: historiesTable.time
        })
        .from(collectionsTable)
        .innerJoin(animeTable, eq(collectionsTable.animeId, animeTable.id))
        .leftJoin(
          historiesTable,
          and(
            eq(historiesTable.animeId, animeTable.id),
            eq(historiesTable.userId, userId)
          )
        )
        .leftJoin(videosTable, eq(historiesTable.videoId, videosTable.id))
        .where(
          and(
            eq(collectionsTable.userId, userId),
            ne(animeTable.status, 'draft')
          )
        )
        .orderBy(desc(collectionsTable.createdAt))
        .limit(COLLECTION_LIMIT);

      const videoStats = await findVideoStats(rows.map(r => r.animeId));

      return rows.map(row => {
        const stats = videoStats.get(row.animeId);
        return {
          animeId: row.animeId,
          // 优先跳转到观看过的那一集（续播），否则取第一集
          videoId: row.watchedVideoId ?? stats?.firstId ?? null,
          name: row.name + buildSeasonSuffix(row.season, row.seasonName),
          cover: row.cover,
          remark: row.remark,
          status: row.status,
          videoCount: stats?.count ?? 0,
          episode: row.watchedEpisode,
          time: row.time
        };
      });
    },

    /** 各类型推荐（每类前 TYPE_ROW_LIMIT 部，按评分降序；adult 类型仅高级会员/管理员可见） */
    async findAnimeTypes(isPrivileged: boolean) {
      const types: AnimeType[] = isPrivileged
        ? ['movie', 'japanese', 'american', 'chinese', 'adult']
        : ['movie', 'japanese', 'american', 'chinese'];

      const rowsByType = await Promise.all(
        types.map(async type =>
          db
            .select({
              animeId: animeTable.id,
              name: animeTable.name,
              season: animeTable.season,
              seasonName: animeTable.seasonName,
              cover: animeTable.cover,
              remark: animeTable.remark,
              status: animeTable.status
            })
            .from(animeTable)
            .where(
              and(eq(animeTable.type, type), ne(animeTable.status, 'draft'))
            )
            .orderBy(
              sql`${animeTable.avgScore} DESC NULLS LAST`,
              desc(animeTable.updatedAt)
            )
            .limit(TYPE_ROW_LIMIT)
        )
      );

      const videoStats = await findVideoStats(
        rowsByType.flat().map(r => r.animeId)
      );

      return (
        rowsByType
          .map((rows, index) => ({
            type: types[index],
            items: rows.map(row => ({
              animeId: row.animeId,
              videoId: videoStats.get(row.animeId)?.firstId ?? null,
              name: row.name + buildSeasonSuffix(row.season, row.seasonName),
              cover: row.cover,
              remark: row.remark,
              status: row.status,
              videoCount: videoStats.get(row.animeId)?.count ?? 0
            }))
          }))
          // 没数据的类型整行不返回（前端自然不渲染）
          .filter(row => row.items.length > 0)
      );
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate('homeRepository', createHomeRepository(fastify));
  },
  {
    name: 'home-repository',
    dependencies: ['db']
  }
);
