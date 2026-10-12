import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import {
  animeTable,
  collectionsTable,
  historiesTable,
  scoresTable,
  videosTable,
  type AnimeType
} from '../../../db/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    playRepository: ReturnType<typeof createPlayRepository>;
  }
}

/** 番剧条目的基础查询列（系列/推荐共用） */
const animeItemColumns = {
  id: animeTable.id,
  name: animeTable.name,
  season: animeTable.season,
  seasonName: animeTable.seasonName,
  cover: animeTable.cover,
  banner: animeTable.banner,
  status: animeTable.status,
  avgScore: animeTable.avgScore,
  seriesId: animeTable.seriesId,
  type: animeTable.type
};

type AnimeItemRow = {
  id: string;
  name: string;
  season: number;
  seasonName: string | null;
  cover: string;
  banner: string;
  status: 'upcoming' | 'airing' | 'completed';
  avgScore: number;
  seriesId: string;
  type: AnimeType;
};

const createPlayRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;
  const { batchStats } = fastify.videosRepository;

  /** 批量附加播放量/追番数/集数与首个视频 ID（保持原有顺序，单次聚合查询） */
  const attachStats = async <T extends AnimeItemRow>(
    rows: T[]
  ): Promise<
    (Omit<T, 'seriesId' | 'type'> & {
      videoCount: number;
      videoId: string | null;
      playCount: number;
      collectionCount: number;
    })[]
  > => {
    if (rows.length === 0) return [];
    const animeIds = rows.map(r => r.id);

    const [videoStats, collectionRows] = await Promise.all([
      batchStats(animeIds),
      db
        .select({
          animeId: collectionsTable.animeId,
          collectionCount: sql<number>`count(*)::int`
        })
        .from(collectionsTable)
        .where(inArray(collectionsTable.animeId, animeIds))
        .groupBy(collectionsTable.animeId)
    ]);

    const collectionsByAnime = new Map(
      collectionRows.map(r => [r.animeId, r.collectionCount])
    );

    return rows.map(({ seriesId, type, ...rest }) => ({
      ...rest,
      videoCount: videoStats.get(rest.id)?.count ?? 0,
      videoId: videoStats.get(rest.id)?.firstId ?? null,
      playCount: videoStats.get(rest.id)?.playCount ?? 0,
      collectionCount: collectionsByAnime.get(rest.id) ?? 0
    }));
  };

  return {
    /** 根据视频 ID 查所属番剧（追番/评分前定位番剧用） */
    async findAnimeByVideo(videoId: string) {
      const [video] = await db
        .select({
          animeId: videosTable.animeId,
          type: animeTable.type
        })
        .from(videosTable)
        .innerJoin(animeTable, eq(videosTable.animeId, animeTable.id))
        .where(eq(videosTable.id, videoId))
        .limit(1);
      return video ?? null;
    },

    /** 播放详情：当前视频 + 番剧信息 + 选集 + 历史/追番/评分状态 + 系列 + 推荐
     *
     * 返回值比 ClientPlayDetailSchema 多 season/seasonName（路由拼季后缀用），
     * 响应序列化时会被 schema 自动剥离
     */
    async findDetail(
      videoId: string,
      userId: string,
      excludeTypes: AnimeType[] | undefined
    ) {
      // video + anime 一次 join 查出（video 不存在或番剧不存在同属无效）
      const [row] = await db
        .select({ video: videosTable, anime: animeTable })
        .from(videosTable)
        .innerJoin(animeTable, eq(videosTable.animeId, animeTable.id))
        .where(eq(videosTable.id, videoId))
        .limit(1);
      if (!row) return null;

      const { video, anime } = row;
      if (excludeTypes?.includes(anime.type)) return null;

      const [
        videos,
        animeHistory,
        collection,
        score,
        seriesRows,
        recommendRows
      ] = await Promise.all([
        db
          .select({
            id: videosTable.id,
            episode: videosTable.episode,
            title: videosTable.title
          })
          .from(videosTable)
          .where(eq(videosTable.animeId, anime.id))
          .orderBy(asc(videosTable.episode)),
        // 动漫维度唯一历史：该动漫下最后观看的一条记录
        db
          .select({
            videoId: historiesTable.videoId,
            time: historiesTable.time
          })
          .from(historiesTable)
          .where(
            and(
              eq(historiesTable.userId, userId),
              eq(historiesTable.animeId, anime.id)
            )
          )
          .limit(1),
        db
          .select({ id: collectionsTable.id })
          .from(collectionsTable)
          .where(
            and(
              eq(collectionsTable.userId, userId),
              eq(collectionsTable.animeId, anime.id)
            )
          )
          .limit(1),
        db
          .select({ id: scoresTable.id })
          .from(scoresTable)
          .where(
            and(
              eq(scoresTable.userId, userId),
              eq(scoresTable.animeId, anime.id)
            )
          )
          .limit(1),
        // 同系列的其他季
        db
          .select(animeItemColumns)
          .from(animeTable)
          .where(
            and(
              eq(animeTable.seriesId, anime.seriesId),
              ne(animeTable.id, anime.id),
              ne(animeTable.status, 'draft')
            )
          )
          .orderBy(asc(animeTable.season)),
        // 推荐：同类型、不同系列，按评分人数/均分排序
        db
          .select(animeItemColumns)
          .from(animeTable)
          .where(
            and(
              eq(animeTable.type, anime.type),
              ne(animeTable.seriesId, anime.seriesId),
              ne(animeTable.status, 'draft'),
              ...(excludeTypes
                ? [notInArray(animeTable.type, excludeTypes)]
                : [])
            )
          )
          .orderBy(
            desc(animeTable.scoreCount),
            desc(animeTable.avgScore),
            asc(animeTable.id)
          )
          .limit(10)
      ]);

      // 三组 stats 互不依赖，并行执行（attachStats 内部各 2 个查询，共 1 轮往返）
      const [[animeStats], series, recommendations] = await Promise.all([
        attachStats([
          {
            ...anime,
            status: anime.status as 'upcoming' | 'airing' | 'completed'
          }
        ] as AnimeItemRow[]),
        attachStats(seriesRows as AnimeItemRow[]),
        attachStats(recommendRows as AnimeItemRow[])
      ]);

      return {
        animeId: anime.id,
        videoId: video.id,
        name: anime.name,
        season: anime.season,
        seasonName: anime.seasonName,
        description: anime.description,
        cover: anime.cover,
        status: anime.status as 'upcoming' | 'airing' | 'completed',
        avgScore: anime.avgScore,
        scoreCount: anime.scoreCount,
        playCount: animeStats?.playCount ?? 0,
        collectionCount: animeStats?.collectionCount ?? 0,
        videoCount: videos.length,
        video: {
          id: video.id,
          url: video.url,
          episode: video.episode
        },
        videos,
        history: animeHistory[0] ?? null,
        // 当前集恢复进度：仅当历史属于当前集时非 0
        time: animeHistory[0]?.videoId === videoId ? animeHistory[0].time : 0,
        isCollected: collection.length > 0,
        isRating: score.length > 0,
        series,
        recommendations
      };
    },

    /** 播放数 +1 */
    async incrementViews(videoId: string) {
      await db
        .update(videosTable)
        .set({ views: sql`${videosTable.views} + 1` })
        .where(eq(videosTable.id, videoId));
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate('playRepository', createPlayRepository(fastify));
  },
  {
    name: 'play-repository',
    dependencies: ['db', 'videos-repository']
  }
);
