import { sql } from 'drizzle-orm';
import { animeTable } from '../db/index.js';

/**
 * 贝叶斯加权评分门槛 m：评分人数低于该值的番剧会被拉向全站均分，
 * 避免「1 人 5 星」的冷门番霸榜。随站点规模调整（IMDb 为 25000）
 */
export const BAYES_MIN_SCORES = 30;

/**
 * 全站加权均分 C（WR 公式的先验）：非 draft 番剧按评分人数加权的均分。
 * 无关联子查询，PG 会走 InitPlan 只算一次
 */
export const globalMeanScore = sql`(
  select coalesce(sum(score_count * avg_score) / nullif(sum(score_count), 0), 0)
  from ${animeTable}
  where ${animeTable.status} <> 'draft'
)`;

/**
 * 贝叶斯加权评分 WR（IMDb 式）：
 * WR = v/(v+m) × R + m/(v+m) × C
 * 番剧实际均分 R 与评分人数 v 加权，评分少的结果被拉向全站均分 C。
 * 配套平 tie-break：scoreCount DESC（有评分排未评分前）→ id ASC
 */
export const bayesianWeightedScore = sql`(
  (${animeTable.scoreCount}::numeric / (${animeTable.scoreCount} + ${BAYES_MIN_SCORES})) *
    ${animeTable.avgScore}
  + (${BAYES_MIN_SCORES}::numeric / (${animeTable.scoreCount} + ${BAYES_MIN_SCORES})) *
    ${globalMeanScore}
)`;
