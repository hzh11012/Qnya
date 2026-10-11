import { writeFile } from 'node:fs/promises';
import { buildApp } from '../src/config/app.js';

/**
 * 导出 OpenAPI 文档到仓库根目录 openapi.json（提交进 git）
 *
 * 前端用 openapi-typescript 从该文件生成接口类型：
 *   cd ../Qnya-Frontend && pnpm gen:api
 *
 * 改动路由/zod schema 后需重新导出并重新生成，tsc 会暴露前后端类型漂移。
 */
const app = await buildApp();
try {
  await app.ready();
  const spec = app.swagger();
  await writeFile(
    new URL('../openapi.json', import.meta.url),
    JSON.stringify(spec, null, 2)
  );
  app.log.info('openapi.json exported');
} finally {
  await app.close();
}
