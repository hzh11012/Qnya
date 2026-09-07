import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { feedbackTable, animeTable, usersTable } from '../../../db/index.js';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import type {
  FeedbackListQuery,
  UpdateFeedbackBody
} from '../../../schemas/feedback.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { escapeLike } from '../../../utils/like.js';
import { t2s } from '../../../utils/t2s.js';

declare module 'fastify' {
  interface FastifyInstance {
    feedbackRepository: ReturnType<typeof createFeedbackRepository>;
  }
}

const createFeedbackRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  return {
    /** 查询反馈列表 */
    async findAll(params: FeedbackListQuery) {
      const { page, pageSize, sort, order, keyword, type, status } = params;

      const conditions = [];

      if (keyword) {
        conditions.push(
          like(feedbackTable.content, `%${escapeLike(t2s(keyword))}%`)
        );
      }

      if (type && type.length > 0) {
        conditions.push(inArray(feedbackTable.type, type));
      }

      if (status && status.length > 0) {
        conditions.push(inArray(feedbackTable.status, status));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const [items, countResult] = await Promise.all([
        db
          .select({
            id: feedbackTable.id,
            userId: feedbackTable.userId,
            animeId: feedbackTable.animeId,
            type: feedbackTable.type,
            content: feedbackTable.content,
            status: feedbackTable.status,
            createdAt: feedbackTable.createdAt,
            userName: usersTable.name,
            animeName: animeTable.name,
            animeSeason: animeTable.season,
            animeSeasonName: animeTable.seasonName,
            animeCover: animeTable.cover
          })
          .from(feedbackTable)
          .leftJoin(animeTable, eq(feedbackTable.animeId, animeTable.id))
          .leftJoin(usersTable, eq(feedbackTable.userId, usersTable.id))
          .where(whereClause)
          .orderBy(
            ...buildOrderBy(feedbackTable[sort], order, feedbackTable.id)
          )
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(feedbackTable)
          .where(whereClause)
      ]);

      return {
        items: items.map(
          ({
            userName,
            animeName,
            animeSeason,
            animeSeasonName,
            animeCover,
            ...rest
          }) => ({
            ...rest,
            user: { name: userName },
            anime: {
              name: `${animeName}${animeSeasonName ? ` ${animeSeasonName}` : animeSeason !== 1 ? ` 第${animeSeason}季` : ''}`,
              cover: animeCover
            }
          })
        ),
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 根据ID查询反馈 */
    async findById(id: number) {
      const [feedback] = await db
        .select()
        .from(feedbackTable)
        .where(eq(feedbackTable.id, id))
        .limit(1);
      return feedback ?? null;
    },

    /** 更新反馈 */
    async update(id: number, data: UpdateFeedbackBody) {
      const [updated] = await db
        .update(feedbackTable)
        .set(data)
        .where(eq(feedbackTable.id, id))
        .returning();
      return updated ?? null;
    },

    /** 删除反馈 */
    async deleteById(id: number) {
      const [deleted] = await db
        .delete(feedbackTable)
        .where(eq(feedbackTable.id, id))
        .returning();
      return deleted ?? null;
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createFeedbackRepository(fastify);
    fastify.decorate('feedbackRepository', repo);
  },
  {
    name: 'feedback-repository',
    dependencies: ['db']
  }
);
