import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  animeTable,
  animeToTagsTable,
  tagsTable,
  videosTable,
  type AnimeType
} from '../../../db/index.js';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  AddAnimeBody,
  AnimeListQuery,
  UpdateAnimeBody
} from '../../../schemas/anime.js';
import { escapeLike } from '../../../utils/like.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { t2s } from '../../../utils/t2s.js';
import { toPinyin, toInitials } from '../../../utils/pinyin.js';

declare module 'fastify' {
  interface FastifyInstance {
    animeRepository: ReturnType<typeof createAnimeRepository>;
  }
}

const createAnimeRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  /** 名称/拼音/首字母联合模糊匹配条件（客户端搜索与管理后台列表共用）
   *
   * 双路匹配支持混合关键词（如 "海z"、"hz王"）：
   * - 归一化路：汉字转全拼/首字母后匹配拼音列
   * - 原始路：保留原始关键词匹配名称与拼音列（纯中文/纯拉丁输入）
   */
  const nameSearchCondition = (keyword: string) => {
    const simplified = t2s(keyword);
    const raw = escapeLike(keyword.toLowerCase());
    const full = escapeLike(toPinyin(simplified).toLowerCase());
    const initials = escapeLike(toInitials(simplified).toLowerCase());
    return sql`(
      ${animeTable.name} ILIKE ${'%' + escapeLike(simplified) + '%'}
      OR ${animeTable.namePinyin} ILIKE ${'%' + full + '%'}
      OR ${animeTable.nameInitials} ILIKE ${'%' + initials + '%'}
      OR ${animeTable.namePinyin} ILIKE ${'%' + raw + '%'}
      OR ${animeTable.nameInitials} ILIKE ${'%' + raw + '%'}
    )`;
  };

  /** 名称精确模糊命中（用于高亮判断） */
  const nameMatchCondition = (keyword: string) => {
    const escaped = escapeLike(t2s(keyword));
    return sql<boolean>`(${animeTable.name} ILIKE ${'%' + escaped + '%'})`;
  };

  /** 相关度排序：名称命中位置 → 拼音命中位置，id 作稳定分页 tiebreaker */
  const relevanceOrderBy = (keyword: string) => {
    const simplified = t2s(keyword);
    const pinyinFull = toPinyin(simplified).toLowerCase();
    return [
      sql`position(${simplified} in ${animeTable.name})`,
      sql`position(${pinyinFull} in ${animeTable.namePinyin})`,
      asc(animeTable.id)
    ];
  };

  return {
    /** 根据 ID 查找 */
    async findById(id: number) {
      const [anime] = await db
        .select()
        .from(animeTable)
        .where(eq(animeTable.id, id))
        .limit(1);
      return anime ?? null;
    },

    /** 根据名称查找 */
    async findByName(name: string) {
      const [anime] = await db
        .select()
        .from(animeTable)
        .where(eq(animeTable.name, name))
        .limit(1);
      return anime ?? null;
    },

    /** 根据名称模糊查找（用于搜索建议） */
    async findByNameLike(keyword: string, excludeTypes?: AnimeType[]) {
      const conditions = [
        nameSearchCondition(keyword),
        // 与搜索列表保持一致，草稿不对外暴露
        notInArray(animeTable.status, ['draft'])
      ];
      if (excludeTypes?.length) {
        conditions.push(notInArray(animeTable.type, excludeTypes));
      }

      return db
        .select({
          id: animeTable.id,
          name: animeTable.name,
          matchedByName: nameMatchCondition(keyword)
        })
        .from(animeTable)
        .where(and(...conditions))
        .orderBy(...relevanceOrderBy(keyword))
        .limit(10);
    },

    /** 根据系列和季查找 */
    async findBySeriesAndSeason(seriesId: number, season: number) {
      const [anime] = await db
        .select()
        .from(animeTable)
        .where(
          and(eq(animeTable.seriesId, seriesId), eq(animeTable.season, season))
        )
        .limit(1);
      return anime ?? null;
    },

    /** 创建番剧 */
    async create(anime: AddAnimeBody) {
      const { tags, ...animeData } = anime;
      return db.transaction(async tx => {
        const [anime] = await tx
          .insert(animeTable)
          .values({
            ...animeData,
            namePinyin: toPinyin(animeData.name),
            nameInitials: toInitials(animeData.name)
          })
          .returning();

        await tx
          .insert(animeToTagsTable)
          .values(tags.map(tagId => ({ animeId: anime.id, tagId })));
        return anime;
      });
    },

    /** 更新番剧 */
    async update(id: number, anime: UpdateAnimeBody) {
      const { tags, ...animeData } = anime;
      await db.transaction(async tx => {
        if (Object.keys(animeData).length > 0) {
          const updateData: typeof animeData & {
            namePinyin?: string;
            nameInitials?: string;
          } = { ...animeData };
          if (animeData.name) {
            updateData.namePinyin = toPinyin(animeData.name);
            updateData.nameInitials = toInitials(animeData.name);
          }
          await tx
            .update(animeTable)
            .set(updateData)
            .where(eq(animeTable.id, id));
        }

        if (tags) {
          await tx
            .delete(animeToTagsTable)
            .where(eq(animeToTagsTable.animeId, id));
          await tx
            .insert(animeToTagsTable)
            .values(tags.map(tagId => ({ animeId: id, tagId })));
        }
      });
    },

    /** 删除番剧（关联表均级联删除） */
    async deleteById(id: number) {
      const [deleted] = await db
        .delete(animeTable)
        .where(eq(animeTable.id, id))
        .returning();
      return deleted ?? null;
    },

    /** 查询列表 */
    async findAll(params: AnimeListQuery) {
      const {
        page,
        pageSize,
        keyword,
        sort,
        order,
        tags,
        status,
        types,
        months,
        years
      } = params;

      // 构建查询条件
      const conditions = [];

      if (keyword) {
        // 与客户端搜索保持一致：同时匹配名称/拼音/首字母
        conditions.push(nameSearchCondition(keyword));
      }
      if (status?.length) {
        conditions.push(inArray(animeTable.status, status));
      }
      if (types?.length) {
        conditions.push(inArray(animeTable.type, types));
      }
      if (years?.length) {
        conditions.push(inArray(animeTable.year, years));
      }
      if (months?.length) {
        conditions.push(inArray(animeTable.month, months));
      }
      if (tags?.length) {
        conditions.push(
          inArray(
            animeTable.id,
            db
              .select({ animeId: animeToTagsTable.animeId })
              .from(animeToTagsTable)
              .where(inArray(animeToTagsTable.tagId, tags))
              .groupBy(animeToTagsTable.animeId)
              .having(
                sql`count(distinct ${animeToTagsTable.tagId}) = ${tags.length}`
              )
          )
        );
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // 主查询 + 计数（并行）
      const items = await db
        .select()
        .from(animeTable)
        .where(whereClause)
        .orderBy(...buildOrderBy(animeTable[sort], order, animeTable.id))
        .limit(pageSize)
        .offset(calcOffset(page, pageSize));

      const animeIds = items.map(a => a.id);

      // 分离查询：批量获取当前页番剧的标签（多对多，避免 lateral join）
      const [tagRows, countResult] = await Promise.all([
        animeIds.length > 0
          ? db
              .select({
                animeId: animeToTagsTable.animeId,
                tagId: tagsTable.id,
                tagName: tagsTable.name
              })
              .from(animeToTagsTable)
              .innerJoin(tagsTable, eq(animeToTagsTable.tagId, tagsTable.id))
              .where(inArray(animeToTagsTable.animeId, animeIds))
          : [],
        db
          .select({ count: sql<number>`count(*)` })
          .from(animeTable)
          .where(whereClause)
      ]);

      const tagsByAnime = new Map<number, { id: number; name: string }[]>();
      for (const r of tagRows) {
        const list = tagsByAnime.get(r.animeId) ?? [];
        list.push({ id: r.tagId, name: r.tagName });
        tagsByAnime.set(r.animeId, list);
      }

      return {
        items: items.map(a => ({
          ...a,
          tags: tagsByAnime.get(a.id) ?? []
        })),
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 搜索列表（带视频信息） */
    async search(
      keyword: string,
      page: number,
      pageSize: number,
      excludeTypes?: AnimeType[]
    ) {
      const conditions = [
        nameSearchCondition(keyword),
        notInArray(animeTable.status, ['draft'])
      ];
      if (excludeTypes?.length) {
        conditions.push(notInArray(animeTable.type, excludeTypes));
      }
      const whereClause = and(...conditions);

      // 主查询（显式列选择，避免向客户端传输未暴露的字段）
      const items = await db
        .select({
          id: animeTable.id,
          name: animeTable.name,
          description: animeTable.description,
          cover: animeTable.cover,
          status: animeTable.status,
          type: animeTable.type,
          director: animeTable.director,
          cv: animeTable.cv,
          year: animeTable.year,
          month: animeTable.month,
          avgScore: animeTable.avgScore,
          scoreCount: animeTable.scoreCount,
          matchedByName: nameMatchCondition(keyword)
        })
        .from(animeTable)
        .where(whereClause)
        .orderBy(...relevanceOrderBy(keyword))
        .limit(pageSize)
        .offset(calcOffset(page, pageSize));

      const animeIds = items.map(a => a.id);

      // 分离查询：标签 + 视频 + 计数（并行，避免 lateral join）
      const [tagRows, videoRows, countResult] = await Promise.all([
        animeIds.length > 0
          ? db
              .select({
                animeId: animeToTagsTable.animeId,
                tagName: tagsTable.name
              })
              .from(animeToTagsTable)
              .innerJoin(tagsTable, eq(animeToTagsTable.tagId, tagsTable.id))
              .where(inArray(animeToTagsTable.animeId, animeIds))
          : [],
        animeIds.length > 0
          ? db
              .select({
                id: videosTable.id,
                episode: videosTable.episode,
                animeId: videosTable.animeId
              })
              .from(videosTable)
              .where(inArray(videosTable.animeId, animeIds))
              .orderBy(asc(videosTable.episode))
          : [],
        db
          .select({ count: sql<number>`count(*)` })
          .from(animeTable)
          .where(whereClause)
      ]);

      const tagsByAnime = new Map<number, string[]>();
      for (const r of tagRows) {
        const list = tagsByAnime.get(r.animeId) ?? [];
        list.push(r.tagName);
        tagsByAnime.set(r.animeId, list);
      }

      const videosByAnime = new Map<
        number,
        { id: number; episode: number }[]
      >();
      for (const r of videoRows) {
        const list = videosByAnime.get(r.animeId) ?? [];
        list.push({ id: r.id, episode: r.episode });
        videosByAnime.set(r.animeId, list);
      }

      return {
        items: items.map(a => {
          const videos = videosByAnime.get(a.id) ?? [];
          return {
            ...a,
            tags: tagsByAnime.get(a.id) ?? [],
            videos,
            videoCount: videos.length,
            videoId: videos.length > 0 ? videos[0].id : null
          };
        }),
        total: Number(countResult[0]?.count ?? 0)
      };
    },

    /** 查询番剧选项 */
    async findAllOptions() {
      return (
        db
          .select({
            label: sql<string>`${animeTable.name} || CASE WHEN ${animeTable.seasonName} IS NOT NULL THEN ' ' || ${animeTable.seasonName} WHEN ${animeTable.season} != 1 THEN ' 第' || ${animeTable.season} || '季' ELSE '' END`,
            value: sql<string>`${animeTable.id}::text`
          })
          .from(animeTable)
          // 草稿未发布，不作为关联选项
          .where(notInArray(animeTable.status, ['draft']))
          .orderBy(asc(animeTable.name))
      );
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createAnimeRepository(fastify);
    fastify.decorate('animeRepository', repo);
  },
  {
    name: 'anime-repository',
    dependencies: ['db']
  }
);
