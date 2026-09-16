import { buildApp } from './config/app.js';
import { ensureUtf8Console } from './bootstrap/console.js';

ensureUtf8Console();

const start = async () => {
  const app = await buildApp();

  // 优雅关闭：docker stop / 重启部署时先处理完在途请求、
  // 再触发 onClose hooks（关闭 DB 连接池、Redis 等）
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      app.log.info(`${signal} received, shutting down gracefully...`);
      void app.close().finally(() => process.exit(0));
    });
  }

  const HOST = '0.0.0.0';
  const PORT = app.config.PORT;

  try {
    await app.listen({ host: HOST, port: PORT });
    app.log.info(`Server listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
