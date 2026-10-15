/**
 * 将未知异常转换为标准 Error 对象
 *
 * 用于全局错误处理器记录日志时规范化异常类型。
 */
export const normalizeError = (e: unknown): Error => {
  if (!(e instanceof Error)) return new Error(String(e));

  // drizzle 会把底层驱动错误包在 DrizzleQueryError（message 为 "Failed query: ..."），
  // 真正的 Postgres 错误码（如 23503 外键、42P10 约束缺失）在 cause 里，
  // 拆包后拼上 code/detail，否则日志和响应里只能看到笼统的 Failed query
  const cause = (e as { cause?: unknown }).cause;
  if (/^Failed query:/.test(e.message) && cause instanceof Error) {
    const pg = cause as Error & { code?: string; detail?: string };
    const suffix = [pg.code, pg.detail].filter(Boolean).join(' | ');
    return new Error(suffix ? `${cause.message} (${suffix})` : cause.message, {
      cause: pg
    });
  }

  return e;
};
