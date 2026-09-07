import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  topicsTable,
  animeToTopicsTable,
  animeTable
} from '../../../db/index.js';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import type {
  TopicListQuery,
  AddTopicBody,
  UpdateTopicBody
} from '../../../schemas/topics.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { escapeLike } from '../../../utils/like.js';
import { t2s } from '../../../utils/t2s.js';

declare module 'fastify' {
  interface FastifyInstance {
    topicsRepository: ReturnType<typeof createTopicsRepository>;
  }
}

const createTopicsRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  return {
    /** 查询专题列表 */
    async findAll(params: TopicListQuery) {
      const { page, pageSize, sort, order, keyword, status } = params;

      const conditions = [];

      if (keyword) {
        conditions.push(
          like(topicsTable.name, `%${escapeLike(t2s(keyword))}%`)
        );
      }

      if (status && status.length > 0) {
        conditions.push(inArray(topicsTable.status, status));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const [topics, countResult] = await Promise.all([
        db
          .select({
            id: topicsTable.id,
            name: topicsTable.name,
            description: topicsTable.description,
            status: topicsTable.status,
            cover: topicsTable.cover,
            createdAt: topicsTable.createdAt
          })
          .from(topicsTable)
          .where(whereClause)
          .orderBy(...buildOrderBy(topicsTable[sort], order, topicsTable.id))
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(topicsTable)
          .where(whereClause)
      ]);

      // 分离查询：批量获取当前页专题关联的番剧（多对多，避免 lateral join）
      const topicIds = topics.map(t => t.id);
      const animeRows =
        topicIds.length > 0
          ? await db
              .select({
                topicId: animeToTopicsTable.topicId,
                animeId: animeTable.id,
                animeName: animeTable.name,
                animeSeason: animeTable.season,
                animeSeasonName: animeTable.seasonName
              })
              .from(animeToTopicsTable)
              .innerJoin(
                animeTable,
                eq(animeToTopicsTable.animeId, animeTable.id)
              )
              .where(inArray(animeToTopicsTable.topicId, topicIds))
          : [];

      const animeByTopic = new Map<number, { id: number; name: string }[]>();
      for (const r of animeRows) {
        const list = animeByTopic.get(r.topicId) ?? [];
        list.push({
          id: r.animeId,
          name: `${r.animeName}${r.animeSeasonName ? ` ${r.animeSeasonName}` : r.animeSeason !== 1 ? ` 第${r.animeSeason}季` : ''}`
        });
        animeByTopic.set(r.topicId, list);
      }

      return {
        items: topics.map(t => ({
          ...t,
          anime: animeByTopic.get(t.id) ?? []
        })),
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 根据ID查询专题 */
    async findById(id: number) {
      const [topic] = await db
        .select()
        .from(topicsTable)
        .where(eq(topicsTable.id, id))
        .limit(1);
      return topic ?? null;
    },

    /** 根据名称查询专题 */
    async findByName(name: string) {
      const [topic] = await db
        .select()
        .from(topicsTable)
        .where(eq(topicsTable.name, name))
        .limit(1);
      return topic ?? null;
    },

    /** 创建专题 */
    async create(data: AddTopicBody) {
      const { animeIds, ...topicData } = data;
      return db.transaction(async tx => {
        const [topic] = await tx
          .insert(topicsTable)
          .values(topicData)
          .returning();

        if (animeIds && animeIds.length > 0) {
          await tx
            .insert(animeToTopicsTable)
            .values(animeIds.map(animeId => ({ animeId, topicId: topic.id })));
        }

        return topic;
      });
    },

    /** 更新专题 */
    async update(id: number, data: UpdateTopicBody) {
      const { animeIds, ...topicData } = data;
      await db.transaction(async tx => {
        if (Object.keys(topicData).length > 0) {
          await tx
            .update(topicsTable)
            .set(topicData)
            .where(eq(topicsTable.id, id));
        }

        if (animeIds !== undefined) {
          await tx
            .delete(animeToTopicsTable)
            .where(eq(animeToTopicsTable.topicId, id));

          if (animeIds.length > 0) {
            await tx
              .insert(animeToTopicsTable)
              .values(animeIds.map(animeId => ({ animeId, topicId: id })));
          }
        }
      });
    },

    /** 删除专题 */
    async deleteById(id: number) {
      const [deleted] = await db
        .delete(topicsTable)
        .where(eq(topicsTable.id, id))
        .returning();
      return deleted ?? null;
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createTopicsRepository(fastify);
    fastify.decorate('topicsRepository', repo);
  },
  {
    name: 'topics-repository',
    dependencies: ['db']
  }
);
