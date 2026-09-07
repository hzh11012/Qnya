/**
 * 将未知异常转换为标准 Error 对象
 *
 * 用于全局错误处理器记录日志时规范化异常类型。
 */
export const normalizeError = (e: unknown): Error =>
  e instanceof Error ? e : new Error(String(e));
