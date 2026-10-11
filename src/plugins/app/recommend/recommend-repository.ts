import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { sql } from 'drizzle-orm';
import { animeAffinityTable, animeTable } from '../../../db/index.js';
import { notInArray } from 'drizzle-orm';

declare module 'fastify' {
  interface FastifyInstance {
    recommendRepository: ReturnType<typeof createRecommendRepository>;
  }
}

/** 单番剧保留的相关番上限，控制亲和表规模 */
const MAX_RELATED_PER_ANIME = 50;

/**
 * 聚合函数返回的时间戳转 Date。
 * pg/drizzle 对 max() 等聚合结果不做类型映射，返回形如
 * "2026-10-12 03:57:38.452694+08" 的字符串，需手动解析。
 */
const toDbDate = (value: unknown): Date | null => {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const text = String(value)
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00');
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const createRecommendRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  return {
    /** 推荐系统状态：最近重建时间 + 亲和记录数 + 可推荐番剧数 */
    async getStatus() {
      const [last, affinity, anime] = await Promise.all([
        db
          .select({
            last: sql<Date | null>`max(${animeAffinityTable.updatedAt})`
          })
          .from(animeAffinityTable),
        db.select({ count: sql<number>`count(*)` }).from(animeAffinityTable),
        db
          .select({ count: sql<number>`count(*)` })
          .from(animeTable)
          .where(notInArray(animeTable.status, ['draft']))
      ]);
      return {
        lastRefreshedAt: toDbDate(last[0]?.last),
        affinityCount: Number(affinity[0]?.count ?? 0),
        animeCount: Number(anime[0]?.count ?? 0)
      };
    },

    /** 上次共现矩阵重建时间（全表 max(updated_at)；空表返回 null） */
    async getLastRefreshedAt(): Promise<Date | null> {
      const [row] = await db
        .select({
          last: sql<Date | null>`max(${animeAffinityTable.updatedAt})`
        })
        .from(animeAffinityTable);
      return toDbDate(row?.last);
    },

    /**
     * 全量重建共现矩阵（事务内先清后插，读侧不锁表）。
     * 互动信号 = 观看历史 ∪ 追番 ∪ 评分（按用户+番剧去重），
     * score = 同时与两番剧有互动的用户数；每个番剧仅保留 top N 相关番。
     */
    async refreshAffinity(): Promise<void> {
      await db.transaction(async tx => {
        await tx.delete(animeAffinityTable);
        await tx.execute(sql`
          WITH interactions AS (
            SELECT user_id, anime_id FROM histories
            UNION
            SELECT user_id, anime_id FROM collections
            UNION
            SELECT user_id, anime_id FROM scores
          ),
          pairs AS (
            SELECT
              i1.anime_id AS anime_id,
              i2.anime_id AS related_anime_id,
              count(DISTINCT i1.user_id)::int AS score
            FROM interactions i1
            JOIN interactions i2
              ON i2.user_id = i1.user_id AND i2.anime_id <> i1.anime_id
            GROUP BY i1.anime_id, i2.anime_id
          ),
          ranked AS (
            SELECT
              anime_id,
              related_anime_id,
              score,
              row_number() OVER (
                PARTITION BY anime_id
                ORDER BY score DESC, related_anime_id
              ) AS rn
            FROM pairs
          )
          INSERT INTO anime_affinity (anime_id, related_anime_id, score, created_at, updated_at)
          SELECT anime_id, related_anime_id, score, now(), now()
          FROM ranked
          WHERE rn <= ${MAX_RELATED_PER_ANIME}
        `);
      });
    }
  };
};

const recommendRepositoryPlugin = fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate('recommendRepository', createRecommendRepository(fastify));
  },
  { name: 'recommend-repository', dependencies: ['db'] }
);

export default recommendRepositoryPlugin;
