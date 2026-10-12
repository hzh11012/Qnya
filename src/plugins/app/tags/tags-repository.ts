import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { tagsTable } from '../../../db/index.js';
import { asc, eq, inArray, like, notInArray, sql } from 'drizzle-orm';
import { TagsListQuery } from '../../../schemas/tags.js';
import { escapeLike } from '../../../utils/like.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { t2s } from '../../../utils/t2s.js';

declare module 'fastify' {
  interface FastifyInstance {
    tagsRepository: ReturnType<typeof createTagsRepository>;
  }
}

/** 成人向标签名单：非特权角色（user/guest）在筛选页不可见 */
const ADULT_TAG_NAMES = ['工口'];

const createTagsRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  return {
    /** 根据 ID 查找 */
    async findById(id: string) {
      const [tag] = await db
        .select()
        .from(tagsTable)
        .where(eq(tagsTable.id, id))
        .limit(1);
      return tag ?? null;
    },

    /** 根据 IDs 查找 */
    async findByIds(ids: string[]) {
      return db.select().from(tagsTable).where(inArray(tagsTable.id, ids));
    },

    /** 根据名称查找 */
    async findByName(name: string) {
      const [tag] = await db
        .select()
        .from(tagsTable)
        .where(eq(tagsTable.name, name))
        .limit(1);
      return tag ?? null;
    },

    /** 查询列表 */
    async findAll(params: TagsListQuery) {
      const { page, pageSize, keyword, sort, order } = params;

      const whereClause = keyword
        ? like(tagsTable.name, `%${escapeLike(t2s(keyword))}%`)
        : undefined;

      const [items, countResult] = await Promise.all([
        db
          .select()
          .from(tagsTable)
          .where(whereClause)
          .orderBy(...buildOrderBy(tagsTable[sort], order, tagsTable.id))
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(tagsTable)
          .where(whereClause)
      ]);

      return { items, total: Number(countResult[0]?.count ?? 0) };
    },

    /** 查询选项 */
    async findAllOptions() {
      return db
        .select({
          label: tagsTable.name,
          value: sql<string>`${tagsTable.id}::text`
        })
        .from(tagsTable);
    },

    /**
     * 客户端筛选页标签选项（按名称排序，不分层页）：
     *  - excludeAdult 为 false（特权角色）：返回全部标签
     *  - excludeAdult 为 true（user/guest）：仅排除成人向标签
     */
    async findClientOptions(excludeAdult: boolean) {
      return db
        .select({ id: tagsTable.id, name: tagsTable.name })
        .from(tagsTable)
        .where(
          excludeAdult ? notInArray(tagsTable.name, ADULT_TAG_NAMES) : undefined
        )
        .orderBy(asc(tagsTable.name));
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createTagsRepository(fastify);
    fastify.decorate('tagsRepository', repo);
  },
  {
    name: 'tags-repository',
    dependencies: ['db']
  }
);
