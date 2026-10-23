import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  ne,
  notInArray,
  sql
} from 'drizzle-orm';
import {
  animeTable,
  collectionsTable,
  historiesTable,
  videosTable
} from '../../../db/index.js';
import { buildSeasonSuffix } from '../../../utils/season.js';
import { bayesianWeightedScore } from '../../../utils/bayesian.js';
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
/** 首页轮播数量 */
const BANNER_LIMIT = 5;
/** 新番发现数量 */
const PICK_LIMIT = 4;

const createHomeRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;
  const { batchStats } = fastify.videosRepository;

  return {
    /**
     * 首页轮播：有 banner 的番剧按每日推荐分排序，最多 BANNER_LIMIT 部
     * （adult 类型仅高级会员/管理员可见）
     *
     * 每日推荐算法：确定性加权打分（同一天内稳定，跨天自然轮换，无状态可缓存）
     *   0.30 × 质量（加权均分归一化，5 分制 → 0~1）
     *   0.30 × 新近度（距最近更新 30 天指数衰减，越新越高）
     *   0.15 × 在播加成（airing = 1，其余 0）
     *   0.25 × 当日随机（md5(日期 + id) 哈希归一，每天变一次）
     */
    async findBanners(isPrivileged: boolean) {
      const conditions = [
        ne(animeTable.status, 'draft'),
        isNotNull(animeTable.banner)
      ];
      if (!isPrivileged)
        conditions.push(notInArray(animeTable.type, ['adult']));

      const dailyScore = sql`
        0.30 * (${animeTable.avgScore} / 5.0)
        + 0.30 * exp(
          -extract(epoch from (now() - ${animeTable.updatedAt})) / 2592000.0
        )
        + 0.15 * case when ${animeTable.status} = 'airing' then 1.0 else 0.0 end
        + 0.25 * (
          abs(
            (
              'x' || substr(
                md5(to_char(current_date, 'YYYY-MM-DD') || ${animeTable.id}::text),
                1,
                8
              )
            )::bit(32)::int
          ) % 10000
        ) / 10000.0`;

      const rows = await db
        .select({
          animeId: animeTable.id,
          name: animeTable.name,
          season: animeTable.season,
          seasonName: animeTable.seasonName,
          banner: animeTable.banner,
          description: animeTable.description,
          remark: animeTable.remark,
          status: animeTable.status
        })
        .from(animeTable)
        .where(and(...conditions))
        .orderBy(desc(dailyScore))
        .limit(BANNER_LIMIT);

      const videoStats = await batchStats(rows.map(r => r.animeId));

      return rows.map(row => ({
        animeId: row.animeId,
        videoId: videoStats.get(row.animeId)?.firstId ?? null,
        name: row.name + buildSeasonSuffix(row.season, row.seasonName),
        // TMDB banner 存的是 w500，大图场景换 w1280 避免拉伸模糊（非 TMDB URL 不含该段，不受影响）
        banner: row.banner?.replace('/w500/', '/w1280/') ?? null,
        description: row.description,
        remark: row.remark,
        status: row.status,
        videoCount: videoStats.get(row.animeId)?.count ?? 0
      }));
    },

    /** 新番发现：最新入库的番剧，最多 PICK_LIMIT 部（adult 类型仅高级会员/管理员可见） */
    async findPicks(isPrivileged: boolean) {
      const conditions = [ne(animeTable.status, 'draft')];
      if (!isPrivileged)
        conditions.push(notInArray(animeTable.type, ['adult']));

      const rows = await db
        .select({
          animeId: animeTable.id,
          name: animeTable.name,
          season: animeTable.season,
          seasonName: animeTable.seasonName,
          cover: animeTable.cover,
          remark: animeTable.remark,
          status: animeTable.status,
          avgScore: animeTable.avgScore,
          scoreCount: animeTable.scoreCount
        })
        .from(animeTable)
        .where(and(...conditions))
        .orderBy(desc(animeTable.createdAt))
        .limit(PICK_LIMIT);

      const videoStats = await batchStats(rows.map(r => r.animeId));

      return rows.map(row => ({
        animeId: row.animeId,
        videoId: videoStats.get(row.animeId)?.firstId ?? null,
        name: row.name + buildSeasonSuffix(row.season, row.seasonName),
        cover: row.cover,
        remark: row.remark,
        status: row.status,
        videoCount: videoStats.get(row.animeId)?.count ?? 0,
        score: row.avgScore,
        scoreCount: row.scoreCount
      }));
    },
    /** 我的追番（最新收藏的前 COLLECTION_LIMIT 部，带观看进度） */
    async findCollections(userId: string) {
      const rows = await db
        .select({
          animeId: animeTable.id,
          name: animeTable.name,
          season: animeTable.season,
          seasonName: animeTable.seasonName,
          // 横版卡片用 banner（竖版海报不合适）
          banner: animeTable.banner,
          remark: animeTable.remark,
          status: animeTable.status,
          avgScore: animeTable.avgScore,
          scoreCount: animeTable.scoreCount,
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

      const videoStats = await batchStats(rows.map(r => r.animeId));

      return rows.map(row => {
        const stats = videoStats.get(row.animeId);
        return {
          animeId: row.animeId,
          // 优先跳转到观看过的那一集（续播），否则取第一集
          videoId: row.watchedVideoId ?? stats?.firstId ?? null,
          name: row.name + buildSeasonSuffix(row.season, row.seasonName),
          banner: row.banner,
          remark: row.remark,
          status: row.status,
          videoCount: stats?.count ?? 0,
          score: row.avgScore,
          scoreCount: row.scoreCount,
          episode: row.watchedEpisode,
          time: row.time
        };
      });
    },

    /** 各类型推荐（每类前 TYPE_ROW_LIMIT 部，按贝叶斯加权评分降序，与热门页同口径；adult 类型仅高级会员/管理员可见） */
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
              status: animeTable.status,
              avgScore: animeTable.avgScore,
              scoreCount: animeTable.scoreCount
            })
            .from(animeTable)
            .where(
              and(eq(animeTable.type, type), ne(animeTable.status, 'draft'))
            )
            .orderBy(
              desc(bayesianWeightedScore),
              // 与热门综合页同口径的平 tie-break
              desc(animeTable.scoreCount),
              asc(animeTable.id)
            )
            .limit(TYPE_ROW_LIMIT)
        )
      );

      const videoStats = await batchStats(
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
              videoCount: videoStats.get(row.animeId)?.count ?? 0,
              score: row.avgScore,
              scoreCount: row.scoreCount
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
    dependencies: ['db', 'videos-repository']
  }
);
