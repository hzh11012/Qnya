/**
 * 判断是否为 PostgreSQL 唯一约束冲突错误（error code 23505）。
 *
 * 用于兜底"先查后插"无法覆盖的并发竞态：数据库层的唯一索引
 * 会拒绝重复数据，这里将底层错误转换为可预期的业务错误。
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
