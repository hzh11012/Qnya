import { asc, desc, SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * 计算分页偏移量
 */
export function calcOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/**
 * 构建排序条件（附带 tiebreaker 保证分页稳定）
 *
 * 始终返回数组：既可直接用于 `findMany({ orderBy })`，
 * 也可用展开运算符用于 `db.select().orderBy(...buildOrderBy(...))`。
 */
export function buildOrderBy(
  column: PgColumn,
  order: 'asc' | 'desc',
  tiebreaker?: PgColumn
): SQL[] {
  const primary = order === 'asc' ? asc(column) : desc(column);
  if (!tiebreaker) return [primary];
  return [primary, order === 'asc' ? asc(tiebreaker) : desc(tiebreaker)];
}
