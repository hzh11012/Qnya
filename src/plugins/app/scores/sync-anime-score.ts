import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../db/index.js';
import { animeTable, scoresTable } from '../../../db/index.js';
import { eq, sql } from 'drizzle-orm';

/** 与 `db.transaction` 回调参数（NodePgTransaction）结构兼容的最小执行器类型 */
type UpdateExecutor = Pick<NodePgDatabase<typeof schema>, 'update'>;

/**
 * 重算番剧的平均评分与评分人数（只统计已审核）。
 *
 * 接受 db 或事务执行器：评分写入与统计重算必须同事务（AGENTS.md 硬性约定 #6），
 * 调用方应在 `db.transaction(async tx => …)` 内传入 tx。
 */
export async function syncAnimeScore(
  executor: UpdateExecutor,
  animeId: string
): Promise<void> {
  await executor
    .update(animeTable)
    .set({
      avgScore: sql`(select coalesce(avg(${scoresTable.score}), 0) from ${scoresTable} where ${scoresTable.animeId} = ${animeId} and ${scoresTable.status})`,
      scoreCount: sql`(select count(*) from ${scoresTable} where ${scoresTable.animeId} = ${animeId} and ${scoresTable.status})`
    })
    .where(eq(animeTable.id, animeId));
}
