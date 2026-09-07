import { buildApp } from './config/app.js';
import { ensureUtf8Console } from './bootstrap/console.js';

ensureUtf8Console();

const start = async () => {
  const app = await buildApp();

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
