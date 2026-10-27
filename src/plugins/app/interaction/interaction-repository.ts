import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { and, asc, count, desc, eq, ilike, sql } from 'drizzle-orm';
import {
  animeTable,
  collectionsTable,
  danmakuTable,
  historiesTable,
  scoresTable,
  videosTable
} from '../../../db/index.js';
import {
  ClientDanmakuCreate,
  ClientHistoryCreate,
  ClientRatingCreate
} from '../../../schemas/play.js';
import { buildSeasonSuffix } from '../../../utils/season.js';
import { syncAnimeScore } from '../scores/sync-anime-score.js';

declare module 'fastify' {
  interface FastifyInstance {
    interactionRepository: ReturnType<typeof createInteractionRepository>;
  }
}

/**
 * 用户×内容互动域：弹幕、观看进度、追番、评分，以及“我的”两个列表。
 * 与 play-repository（播放详情）分离，与 admin 端 collections/histories
 * 仓（管理视角）分属不同视角。
 */
const createInteractionRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;
  const { batchStats } = fastify.videosRepository;

  return {
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

    /** 用户统计：追番数与历史部数（我的页面信息条展示用） */
    async getUserStats(userId: string) {
      // 两个计数互不依赖，并行发（复用连接池）
      const [collections, histories] = await Promise.all([
        db
          .select({ value: count() })
          .from(collectionsTable)
          .where(eq(collectionsTable.userId, userId)),
        db
          .select({ value: count() })
          .from(historiesTable)
          .where(eq(historiesTable.userId, userId))
      ]);
      return {
        collections: collections[0].value,
        histories: histories[0].value
      };
    },

    /** 删除用户对某动漫的历史记录，返回是否有删除 */
    async deleteHistory(userId: string, animeId: string) {
      const deleted = await db
        .delete(historiesTable)
        .where(
          and(
            eq(historiesTable.userId, userId),
            eq(historiesTable.animeId, animeId)
          )
        )
        .returning({ id: historiesTable.id });
      return deleted.length > 0;
    },

    /** 清空用户全部历史记录，返回删除条数 */
    async clearHistories(userId: string) {
      const deleted = await db
        .delete(historiesTable)
        .where(eq(historiesTable.userId, userId))
        .returning({ id: historiesTable.id });
      return deleted.length;
    },

    /** 切换追番状态，返回切换后的状态 */
    async toggleCollection(animeId: string, userId: string) {
      // 先删：已追番则删除即完成切换（一次往返）
      const deleted = await db
        .delete(collectionsTable)
        .where(
          and(
            eq(collectionsTable.userId, userId),
            eq(collectionsTable.animeId, animeId)
          )
        )
        .returning({ id: collectionsTable.id });
      if (deleted.length > 0) return false;

      await db.insert(collectionsTable).values({ userId, animeId });
      return true;
    },

    /** 提交评分（未评过分则新建，否则更新），并同步番剧评分统计 */
    async createRating(
      animeId: string,
      userId: string,
      data: ClientRatingCreate
    ) {
      // 评分写入与统计重算同事务（硬性约定 #6）
      await db.transaction(async tx => {
        await tx
          .insert(scoresTable)
          .values({ animeId, userId, score: data.score, content: data.content })
          .onConflictDoUpdate({
            target: [scoresTable.userId, scoresTable.animeId],
            set: { score: data.score, content: data.content }
          });

        await syncAnimeScore(tx, animeId);
      });
    },

    /** 我的追番分页（附带每部番第一集 videoId，用于跳转播放） */
    async findUserCollections(userId: string, page: number, pageSize: number) {
      const where = eq(collectionsTable.userId, userId);

      const [rows, countResult] = await Promise.all([
        db
          .select({
            animeId: collectionsTable.animeId,
            name: animeTable.name,
            season: animeTable.season,
            seasonName: animeTable.seasonName,
            cover: animeTable.cover,
            remark: animeTable.remark,
            status: animeTable.status,
            avgScore: animeTable.avgScore,
            collectedAt: collectionsTable.createdAt
          })
          .from(collectionsTable)
          .innerJoin(animeTable, eq(collectionsTable.animeId, animeTable.id))
          .where(where)
          .orderBy(desc(collectionsTable.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db
          .select({ count: sql<number>`count(*)` })
          .from(collectionsTable)
          .where(where)
      ]);

      const videoStats = await batchStats(rows.map(r => r.animeId));

      return {
        items: rows.map(row => ({
          animeId: row.animeId,
          name: row.name + buildSeasonSuffix(row.season, row.seasonName),
          cover: row.cover,
          remark: row.remark,
          status: row.status,
          videoCount: videoStats.get(row.animeId)?.count ?? 0,
          avgScore: row.avgScore,
          videoId: videoStats.get(row.animeId)?.firstId ?? null,
          collectedAt: row.collectedAt
        })),
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 我的历史分页（最后观看的一集 + 进度秒数）；keyword 按番剧名模糊匹配 */
    async findUserHistories(
      userId: string,
      page: number,
      pageSize: number,
      keyword?: string
    ) {
      const eqUser = eq(historiesTable.userId, userId);
      // LIKE 通配符转义，避免用户输入 % / _ 影响匹配范围
      const escaped = keyword?.replace(/[\\%_]/g, '\\$&');
      const where = escaped
        ? and(eqUser, ilike(animeTable.name, `%${escaped}%`))
        : eqUser;

      const [rows, countResult] = await Promise.all([
        db
          .select({
            animeId: videosTable.animeId,
            videoId: historiesTable.videoId,
            time: historiesTable.time,
            episode: videosTable.episode,
            videoTitle: videosTable.title,
            name: animeTable.name,
            season: animeTable.season,
            seasonName: animeTable.seasonName,
            banner: animeTable.banner,
            watchedAt: historiesTable.updatedAt
          })
          .from(historiesTable)
          .innerJoin(videosTable, eq(historiesTable.videoId, videosTable.id))
          .innerJoin(animeTable, eq(videosTable.animeId, animeTable.id))
          .where(where)
          .orderBy(desc(historiesTable.updatedAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        // keyword 过滤引用了 anime 表，计数查询必须带相同的 join
        escaped
          ? db
              .select({ count: sql<number>`count(*)` })
              .from(historiesTable)
              .innerJoin(
                videosTable,
                eq(historiesTable.videoId, videosTable.id)
              )
              .innerJoin(animeTable, eq(videosTable.animeId, animeTable.id))
              .where(where)
          : db
              .select({ count: sql<number>`count(*)` })
              .from(historiesTable)
              .where(where)
      ]);

      return {
        items: rows.map(row => ({
          animeId: row.animeId,
          name: row.name + buildSeasonSuffix(row.season, row.seasonName),
          banner: row.banner,
          videoId: row.videoId,
          episode: row.episode,
          videoTitle: row.videoTitle,
          time: row.time,
          watchedAt: row.watchedAt
        })),
        total: Number(countResult[0]?.count ?? 0)
      };
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate(
      'interactionRepository',
      createInteractionRepository(fastify)
    );
  },
  {
    name: 'interaction-repository',
    dependencies: ['db', 'videos-repository']
  }
);
