import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import {
  animeTable,
  collectionsTable,
  danmakuTable,
  historiesTable,
  scoresTable,
  videosTable,
  type AnimeType
} from '../../../db/index.js';
import {
  ClientDanmakuCreate,
  ClientHistoryCreate,
  ClientRatingCreate
} from '../../../schemas/play.js';

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

  /** 批量附加播放量/追番数/集数与首个视频 ID（保持原有顺序） */
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

    const [videoRows, viewRows, collectionRows] = await Promise.all([
      db
        .select({ id: videosTable.id, animeId: videosTable.animeId })
        .from(videosTable)
        .where(inArray(videosTable.animeId, animeIds))
        .orderBy(asc(videosTable.episode)),
      db
        .select({
          animeId: videosTable.animeId,
          playCount: sql<number>`coalesce(sum(${videosTable.views}), 0)::int`
        })
        .from(videosTable)
        .where(inArray(videosTable.animeId, animeIds))
        .groupBy(videosTable.animeId),
      db
        .select({
          animeId: collectionsTable.animeId,
          collectionCount: sql<number>`count(*)::int`
        })
        .from(collectionsTable)
        .where(inArray(collectionsTable.animeId, animeIds))
        .groupBy(collectionsTable.animeId)
    ]);

    const firstVideo = new Map<string, string>();
    for (const r of videoRows) {
      if (!firstVideo.has(r.animeId)) firstVideo.set(r.animeId, r.id);
    }
    const viewsByAnime = new Map(viewRows.map(r => [r.animeId, r.playCount]));
    const collectionsByAnime = new Map(
      collectionRows.map(r => [r.animeId, r.collectionCount])
    );

    return rows.map(({ seriesId, type, ...rest }) => ({
      ...rest,
      videoCount: videoRows.filter(v => v.animeId === rest.id).length,
      videoId: firstVideo.get(rest.id) ?? null,
      playCount: viewsByAnime.get(rest.id) ?? 0,
      collectionCount: collectionsByAnime.get(rest.id) ?? 0
    }));
  };

  /** 重建番剧的平均评分与评分人数（只统计已审核，评分提交后调用） */
  const syncAnimeScore = async (animeId: string) => {
    await db
      .update(animeTable)
      .set({
        avgScore: sql`(select coalesce(avg(${scoresTable.score}), 0) from ${scoresTable} where ${scoresTable.animeId} = ${animeId} and ${scoresTable.status})`,
        scoreCount: sql`(select count(*) from ${scoresTable} where ${scoresTable.animeId} = ${animeId} and ${scoresTable.status})`
      })
      .where(eq(animeTable.id, animeId));
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
      const [video] = await db
        .select()
        .from(videosTable)
        .where(eq(videosTable.id, videoId))
        .limit(1);
      if (!video) return null;

      const [anime] = await db
        .select()
        .from(animeTable)
        .where(eq(animeTable.id, video.animeId))
        .limit(1);
      if (!anime) return null;
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

      const [animeStats] = await attachStats([
        {
          ...anime,
          status: anime.status as 'upcoming' | 'airing' | 'completed'
        }
      ] as AnimeItemRow[]);

      const series = await attachStats(seriesRows as AnimeItemRow[]);
      const recommendations = await attachStats(
        recommendRows as AnimeItemRow[]
      );

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
    },

    /** 弹幕列表（按出现时间排序） */
    async findDanmakus(videoId: string) {
      return db
        .select({
          text: danmakuTable.text,
          color: danmakuTable.color,
          mode: danmakuTable.mode,
          time: danmakuTable.time
        })
        .from(danmakuTable)
        .where(eq(danmakuTable.videoId, videoId))
        .orderBy(asc(danmakuTable.time));
    },

    /** 发送弹幕 */
    async createDanmaku(
      videoId: string,
      userId: string,
      data: ClientDanmakuCreate
    ) {
      const [created] = await db
        .insert(danmakuTable)
        .values({ videoId, userId, ...data })
        .returning();
      return created;
    },

    /** 保存/更新观看进度（动漫维度唯一，换集时更新记录的 videoId） */
    async upsertHistory(
      videoId: string,
      userId: string,
      data: ClientHistoryCreate
    ) {
      const [video] = await db
        .select({ animeId: videosTable.animeId })
        .from(videosTable)
        .where(eq(videosTable.id, videoId))
        .limit(1);
      if (!video) return;

      await db
        .insert(historiesTable)
        .values({ videoId, userId, animeId: video.animeId, time: data.time })
        .onConflictDoUpdate({
          target: [historiesTable.userId, historiesTable.animeId],
          set: { videoId, time: data.time }
        });
    },

    /** 切换追番状态，返回切换后的状态 */
    async toggleCollection(animeId: string, userId: string) {
      const [existing] = await db
        .select({ id: collectionsTable.id })
        .from(collectionsTable)
        .where(
          and(
            eq(collectionsTable.userId, userId),
            eq(collectionsTable.animeId, animeId)
          )
        )
        .limit(1);

      if (existing) {
        await db
          .delete(collectionsTable)
          .where(eq(collectionsTable.id, existing.id));
        return false;
      }

      await db.insert(collectionsTable).values({ userId, animeId });
      return true;
    },

    /** 提交评分（未评过分则新建，否则更新），并同步番剧评分统计 */
    async createRating(
      animeId: string,
      userId: string,
      data: ClientRatingCreate
    ) {
      await db
        .insert(scoresTable)
        .values({ animeId, userId, score: data.score, content: data.content })
        .onConflictDoUpdate({
          target: [scoresTable.userId, scoresTable.animeId],
          set: { score: data.score, content: data.content }
        });

      await syncAnimeScore(animeId);
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate('playRepository', createPlayRepository(fastify));
  },
  {
    name: 'play-repository',
    dependencies: ['db']
  }
);
