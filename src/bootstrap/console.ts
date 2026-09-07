import { execSync } from 'node:child_process';

/**
 * Windows 控制台默认 GBK(936) 代码页，pino-pretty 经 worker 输出 UTF-8 字节流
 * 会导致中文 / emoji 日志乱码。切到 UTF-8(65001) 代码页以正确显示。
 */
export function ensureUtf8Console(): void {
  if (process.platform !== 'win32') return;
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch {
    // 无控制台（stdout 被重定向）或 chcp 不可用时忽略
  }
}
