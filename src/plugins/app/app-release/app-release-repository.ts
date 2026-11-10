import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { desc, eq, sql } from 'drizzle-orm';
import { appReleasesTable } from '../../../db/index.js';
import type {
  AppReleaseListQuery,
  AppPlatform,
  CreateAppReleaseBody,
  UpdateAppReleaseBody
} from '../../../schemas/app.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';

declare module 'fastify' {
  interface FastifyInstance {
    appReleaseRepository: ReturnType<typeof createAppReleaseRepository>;
  }
}

const createAppReleaseRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  return {
    /** 客户端 — 指定平台的最新版本（versionCode 最大的一条，无发布记录返回 null） */
    async findLatest(platform: AppPlatform) {
      const [release] = await db
        .select({
          versionCode: appReleasesTable.versionCode,
          versionName: appReleasesTable.versionName,
          url: appReleasesTable.url,
          changelog: appReleasesTable.changelog
        })
        .from(appReleasesTable)
        .where(eq(appReleasesTable.platform, platform))
        .orderBy(desc(appReleasesTable.versionCode))
        .limit(1);
      return release ?? null;
    },

    /** 后台 — 版本发布列表（分页，可按平台筛选，默认 createdAt 降序） */
    async findAll(params: AppReleaseListQuery) {
      const { page, pageSize, sort, order, platform } = params;
      const sortColumn = appReleasesTable[sort];
      const where = platform
        ? eq(appReleasesTable.platform, platform)
        : undefined;

      const [items, countResult] = await Promise.all([
        db
          .select()
          .from(appReleasesTable)
          .where(where)
          .orderBy(...buildOrderBy(sortColumn, order, appReleasesTable.id))
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(appReleasesTable)
          .where(where)
      ]);

      return {
        items,
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 后台 — 发布新版本（versionCode 服务端自动递增，仅作存档序号） */
    async create(data: CreateAppReleaseBody) {
      // 序号在 INSERT 内取 MAX+1，避免并发发布取到同一序号
      const [created] = await db
        .insert(appReleasesTable)
        .values({
          ...data,
          versionCode: sql`(
            SELECT COALESCE(MAX(${appReleasesTable.versionCode}), 0) + 1
            FROM ${appReleasesTable}
          )`
        })
        .returning();
      return created ?? null;
    },

    /** 后台 — 修改版本发布记录 */
    async updateById(id: string, data: UpdateAppReleaseBody) {
      const [updated] = await db
        .update(appReleasesTable)
        .set(data)
        .where(eq(appReleasesTable.id, id))
        .returning();
      return updated ?? null;
    },

    /** 后台 — 删除版本发布记录 */
    async deleteById(id: string) {
      const [deleted] = await db
        .delete(appReleasesTable)
        .where(eq(appReleasesTable.id, id))
        .returning();
      return deleted ?? null;
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createAppReleaseRepository(fastify);
    fastify.decorate('appReleaseRepository', repo);
  },
  {
    name: 'app-release-repository',
    dependencies: ['db']
  }
);
