import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { desc, eq, sql } from 'drizzle-orm';
import {
  animeTable,
  collectionsTable,
  danmakuTable,
  feedbackTable,
  historiesTable,
  scoresTable,
  seriesTable,
  tasksTable,
  topicsTable,
  usersTable,
  videosTable
} from '../../../db/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    dashboardRepository: ReturnType<typeof createDashboardRepository>;
  }
}

const CACHE_KEY = 'dashboard:stats';
/** 缓存 TTL：30 秒 */
const CACHE_TTL = 30;

const createDashboardRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;
  const redis = fastify.redis;

  return {
    /** 获取仪表盘统计数据（带 Redis 缓存） */
    async getStats() {
      return (async () => {
        // 1. 先查缓存
        const cached = await redis.get(CACHE_KEY);
        if (cached) {
          return JSON.parse(cached);
        }

        // 2. 缓存未命中，并行执行所有查询（含健康检测）
        const [
          // 内容
          animeCounts,
          animeStatusCounts,
          animeTypeCounts,
          [{ videoTotal }],
          [{ seriesTotal }],
          [{ topicTotal }],
          // 用户
          [{ userTotal }],
          [{ activeUsers }],
          userRoleCounts,
          // 互动
          [{ danmakuTotal }],
          [{ historyTotal }],
          [{ collectionTotal }],
          [{ scoreTotal }],
          // 任务
          taskStatusCounts,
          // 待处理反馈数
          [{ pendingFeedbacks }],
          // 运营数据
          topCollections,
          recentFeedbacks,
          recentScores,
          // 系统健康（并入并行，不额外消耗时间）
          dbLatency,
          redisLatency
        ] = await Promise.all([
          // 番剧总数
          db.select({ count: sql<number>`count(*)` }).from(animeTable),
          // 番剧各状态数
          db
            .select({
              status: animeTable.status,
              count: sql<number>`count(*)`
            })
            .from(animeTable)
            .groupBy(animeTable.status),
          // 番剧各类型数
          db
            .select({ type: animeTable.type, count: sql<number>`count(*)` })
            .from(animeTable)
            .groupBy(animeTable.type),
          // 视频总数
          db.select({ videoTotal: sql<number>`count(*)` }).from(videosTable),
          // 系列总数
          db.select({ seriesTotal: sql<number>`count(*)` }).from(seriesTable),
          // 专题总数
          db.select({ topicTotal: sql<number>`count(*)` }).from(topicsTable),
          // 用户总数
          db.select({ userTotal: sql<number>`count(*)` }).from(usersTable),
          // 活跃用户
          db
            .select({ activeUsers: sql<number>`count(*)` })
            .from(usersTable)
            .where(eq(usersTable.status, true)),
          // 用户各角色数
          db
            .select({ role: usersTable.role, count: sql<number>`count(*)` })
            .from(usersTable)
            .groupBy(usersTable.role),
          // 弹幕总数
          db.select({ danmakuTotal: sql<number>`count(*)` }).from(danmakuTable),
          // 观看记录总数
          db
            .select({ historyTotal: sql<number>`count(*)` })
            .from(historiesTable),
          // 追番总数
          db
            .select({ collectionTotal: sql<number>`count(*)` })
            .from(collectionsTable),
          // 评分总数
          db.select({ scoreTotal: sql<number>`count(*)` }).from(scoresTable),
          // 任务各状态数
          db
            .select({
              status: tasksTable.status,
              count: sql<number>`count(*)`
            })
            .from(tasksTable)
            .groupBy(tasksTable.status),
          // 待处理反馈数
          db
            .select({ pendingFeedbacks: sql<number>`count(*)` })
            .from(feedbackTable)
            .where(eq(feedbackTable.status, 'pending')),
          // 追番排行 Top 10
          db
            .select({
              animeId: collectionsTable.animeId,
              animeName: animeTable.name,
              cover: animeTable.cover,
              count: sql<number>`count(*)`
            })
            .from(collectionsTable)
            .innerJoin(animeTable, eq(collectionsTable.animeId, animeTable.id))
            .groupBy(
              collectionsTable.animeId,
              animeTable.name,
              animeTable.cover
            )
            .orderBy(desc(sql`count(*)`))
            .limit(10),
          // 最新 pending 反馈 10 条
          db
            .select({
              id: feedbackTable.id,
              animeName: animeTable.name,
              type: feedbackTable.type,
              content: feedbackTable.content,
              createdAt: feedbackTable.createdAt
            })
            .from(feedbackTable)
            .innerJoin(animeTable, eq(feedbackTable.animeId, animeTable.id))
            .where(eq(feedbackTable.status, 'pending'))
            .orderBy(desc(feedbackTable.createdAt))
            .limit(10),
          // 最新评分 10 条
          db
            .select({
              id: scoresTable.id,
              userName: usersTable.name,
              animeName: animeTable.name,
              score: scoresTable.score,
              content: scoresTable.content,
              createdAt: scoresTable.createdAt
            })
            .from(scoresTable)
            .innerJoin(usersTable, eq(scoresTable.userId, usersTable.id))
            .innerJoin(animeTable, eq(scoresTable.animeId, animeTable.id))
            .orderBy(desc(scoresTable.createdAt))
            .limit(10),
          // DB 健康检测
          (async () => {
            const start = Date.now();
            try {
              await db.$client.query('SELECT 1');
              return { status: 'ok' as const, latency: Date.now() - start };
            } catch {
              return { status: 'error' as const, latency: undefined };
            }
          })(),
          // Redis 健康检测
          (async () => {
            const start = Date.now();
            try {
              await redis.ping();
              return { status: 'ok' as const, latency: Date.now() - start };
            } catch {
              return { status: 'error' as const, latency: undefined };
            }
          })()
        ]);

        // 将数组结果转为 map
        const statusMap = Object.fromEntries(
          animeStatusCounts.map(r => [r.status, Number(r.count)])
        );
        const typeMap = Object.fromEntries(
          animeTypeCounts.map(r => [r.type, Number(r.count)])
        );
        const roleMap = Object.fromEntries(
          userRoleCounts.map(r => [r.role, Number(r.count)])
        );
        const taskMap = Object.fromEntries(
          taskStatusCounts.map(r => [r.status, Number(r.count)])
        );

        const data = {
          content: {
            animeTotal: Number(animeCounts[0]?.count ?? 0),
            animeByStatus: {
              draft: statusMap['draft'] ?? 0,
              upcoming: statusMap['upcoming'] ?? 0,
              airing: statusMap['airing'] ?? 0,
              completed: statusMap['completed'] ?? 0
            },
            animeByType: {
              movie: typeMap['movie'] ?? 0,
              japanese: typeMap['japanese'] ?? 0,
              american: typeMap['american'] ?? 0,
              chinese: typeMap['chinese'] ?? 0,
              adult: typeMap['adult'] ?? 0
            },
            videoTotal: Number(videoTotal ?? 0),
            seriesTotal: Number(seriesTotal ?? 0),
            topicTotal: Number(topicTotal ?? 0)
          },
          users: {
            total: Number(userTotal ?? 0),
            active: Number(activeUsers ?? 0),
            byRole: {
              admin: roleMap['admin'] ?? 0,
              premium: roleMap['premium'] ?? 0,
              user: roleMap['user'] ?? 0,
              guest: roleMap['guest'] ?? 0
            }
          },
          interaction: {
            danmakuTotal: Number(danmakuTotal ?? 0),
            historyTotal: Number(historyTotal ?? 0),
            collectionTotal: Number(collectionTotal ?? 0),
            scoreTotal: Number(scoreTotal ?? 0)
          },
          tasks: {
            pending: taskMap['pending'] ?? 0,
            completed: taskMap['completed'] ?? 0
          },
          pending: {
            feedbacks: Number(pendingFeedbacks ?? 0)
          },
          topCollections: topCollections.map(r => ({
            ...r,
            count: Number(r.count)
          })),
          recentFeedbacks,
          recentScores: recentScores.map(r => ({
            ...r,
            score: Number(r.score)
          })),
          system: {
            database: dbLatency,
            redis: redisLatency
          }
        };

        // 3. 写入缓存
        await redis.set(CACHE_KEY, JSON.stringify(data), 'EX', CACHE_TTL);

        return data;
      })();
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate('dashboardRepository', createDashboardRepository(fastify));
  },
  {
    name: 'dashboard-repository',
    dependencies: ['db', 'redis']
  }
);
