import 'dotenv/config';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/**
 * 独立迁移脚本：编译后随生产镜像分发（dist/db/migrate.js），
 * 供 docker-entrypoint 在应用启动前执行。
 * 不依赖 drizzle-kit（devDependency，生产镜像中不存在）。
 *
 * 连接参数与 src/plugins/external/env.ts 中的 POSTGRES_* 保持一致。
 */
const {
  POSTGRES_HOST = 'localhost',
  POSTGRES_PORT = '5432',
  POSTGRES_USER = 'qnya',
  POSTGRES_PASSWORD,
  POSTGRES_DB = 'qnya'
} = process.env;

const main = async () => {
  const pool = new pg.Pool({
    host: POSTGRES_HOST,
    port: Number(POSTGRES_PORT),
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    database: POSTGRES_DB
  });

  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    console.log('[migrate] Database migrations applied');
  } finally {
    await pool.end();
  }
};

main().catch(err => {
  console.error('[migrate] Migration failed:', err);
  process.exit(1);
});
