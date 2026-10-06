import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  topicsTable,
  animeToTopicsTable,
  animeTable
} from '../../../db/index.js';
import { and, asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type {
  TopicListQuery,
  AddTopicBody,
  UpdateTopicBody
} from '../../../schemas/topics.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { escapeLike } from '../../../utils/like.js';
import { buildSeasonSuffix } from '../../../utils/season.js';
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

      const animeByTopic = new Map<string, { id: string; name: string }[]>();
      for (const r of animeRows) {
        const list = animeByTopic.get(r.topicId) ?? [];
        list.push({
          id: r.animeId,
          name: `${r.animeName}${buildSeasonSuffix(r.animeSeason, r.animeSeasonName)}`
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
    async findById(id: string) {
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
    async update(id: string, data: UpdateTopicBody) {
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

    /** 客户端：已发布专题分页（含番剧数量） */
    async findPublished(params: { page: number; pageSize: number }) {
      const { page, pageSize } = params;
      const where = eq(topicsTable.status, true);

      const [topics, countResult] = await Promise.all([
        db
          .select({
            id: topicsTable.id,
            name: topicsTable.name,
            description: topicsTable.description,
            cover: topicsTable.cover,
            animeCount: sql<number>`count(${animeToTopicsTable.animeId})`
          })
          .from(topicsTable)
          .leftJoin(
            animeToTopicsTable,
            eq(animeToTopicsTable.topicId, topicsTable.id)
          )
          .where(where)
          .groupBy(topicsTable.id)
          .orderBy(desc(topicsTable.createdAt))
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(topicsTable)
          .where(where)
      ]);

      return {
        items: topics.map(t => ({
          ...t,
          animeCount: Number(t.animeCount)
        })),
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 客户端：已发布专题详情（含关联番剧，按加入顺序） */
    async findPublishedDetail(id: string, excludeTypes: string[] = []) {
      const topic = await this.findById(id);
      if (!topic || !topic.status) return null;

      const rows = await db
        .select({ animeId: animeToTopicsTable.animeId })
        .from(animeToTopicsTable)
        .where(eq(animeToTopicsTable.topicId, id))
        .orderBy(asc(animeToTopicsTable.createdAt));

      const ids = rows.map(r => r.animeId);
      const animes =
        ids.length > 0
          ? await fastify.animeRepository.findByIdsWithMeta(ids)
          : [];

      const byId = new Map(animes.map(a => [a.id, a]));
      const anime = ids
        .map(animeId => byId.get(animeId))
        .filter((a): a is NonNullable<typeof a> => !!a)
        // 过滤草稿与角色无权查看的类型
        .filter(a => a.status !== 'draft' && !excludeTypes.includes(a.type))
        // 展示文案 = 名称 + 季后缀（与搜索列表一致）
        .map(a => ({
          ...a,
          name: a.name + buildSeasonSuffix(a.season, a.seasonName)
        }));

      return {
        id: topic.id,
        name: topic.name,
        description: topic.description,
        cover: topic.cover,
        anime
      };
    },

    /** 删除专题 */
    async deleteById(id: string) {
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
    dependencies: ['db', 'anime-repository']
  }
);
