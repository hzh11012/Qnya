import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  animeTable,
  animeToTagsTable,
  tagsTable,
  videosTable
} from '../../../db/index.js';
import { and, asc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import {
  AddAnimeBody,
  AnimeListQuery,
  UpdateAnimeBody
} from '../../../schemas/anime.js';
import { escapeLike } from '../../../utils/like.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { t2s } from '../../../utils/t2s.js';
import { buildSeasonSuffix } from '../../../utils/season.js';
import { toPinyin, toInitials } from '../../../utils/pinyin.js';

declare module 'fastify' {
  interface FastifyInstance {
    animeRepository: ReturnType<typeof createAnimeRepository>;
  }
}

const createAnimeRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  /** 名称/拼音/首字母联合模糊匹配条件（管理后台列表关键词过滤使用）
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

  /** 客户端搜索结果列 */
  const clientColumns = {
    id: animeTable.id,
    name: animeTable.name,
    season: animeTable.season,
    seasonName: animeTable.seasonName,
    description: animeTable.description,
    cover: animeTable.cover,
    status: animeTable.status,
    type: animeTable.type,
    director: animeTable.director,
    cv: animeTable.cv,
    year: animeTable.year,
    month: animeTable.month,
    avgScore: animeTable.avgScore,
    scoreCount: animeTable.scoreCount
  };

  /** 批量获取番剧的标签与视频信息并附加到行上（保持原有顺序） */
  const attachMeta = async <T extends { id: string }>(rows: T[]) => {
    const animeIds = rows.map(a => a.id);

    const [tagRows, videoRows] = await Promise.all([
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
        : []
    ]);

    const tagsByAnime = new Map<string, string[]>();
    for (const r of tagRows) {
      const list = tagsByAnime.get(r.animeId) ?? [];
      list.push(r.tagName);
      tagsByAnime.set(r.animeId, list);
    }

    const videosByAnime = new Map<string, { id: string; episode: number }[]>();
    for (const r of videoRows) {
      const list = videosByAnime.get(r.animeId) ?? [];
      list.push({ id: r.id, episode: r.episode });
      videosByAnime.set(r.animeId, list);
    }

    return rows.map(a => {
      const videos = videosByAnime.get(a.id) ?? [];
      return {
        ...a,
        tags: tagsByAnime.get(a.id) ?? [],
        videos,
        videoCount: videos.length,
        videoId: videos.length > 0 ? videos[0]!.id : null
      };
    });
  };

  /** 同步番剧变更到搜索索引（best-effort，失败仅告警，不影响主流程） */
  const syncAnime = async (anime: typeof animeTable.$inferSelect) => {
    await fastify.animeSearch.syncAnime(anime);
  };

  const removeFromIndex = async (id: string) => {
    await fastify.animeSearch.removeAnime(id);
  };

  return {
    /** 根据 ID 查找 */
    async findById(id: string) {
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

    /** 根据系列和季查找 */
    async findBySeriesAndSeason(seriesId: string, season: number) {
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
      const created = await db.transaction(async tx => {
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

      await syncAnime(created);
      return created;
    },

    /** 更新番剧 */
    async update(id: string, anime: UpdateAnimeBody) {
      const { tags, ...animeData } = anime;
      let updated: typeof animeTable.$inferSelect | undefined;
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
          [updated] = await tx
            .update(animeTable)
            .set(updateData)
            .where(eq(animeTable.id, id))
            .returning();
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

      // 名称/状态变更需要同步搜索索引（仅改标签时同步也无害，索引不含标签）
      if (updated) {
        await syncAnime(updated);
      }
    },

    /** 删除番剧（关联表均级联删除） */
    async deleteById(id: string) {
      const [deleted] = await db
        .delete(animeTable)
        .where(eq(animeTable.id, id))
        .returning();

      if (deleted) {
        await removeFromIndex(deleted.id);
      }
      return deleted ?? null;
    },

    /** 批量按 ID 获取搜索结果（供 meilisearch 命中后水合标签/视频信息） */
    async findByIdsWithMeta(ids: string[]) {
      if (ids.length === 0) return [];
      const rows = await db
        .select(clientColumns)
        .from(animeTable)
        .where(inArray(animeTable.id, ids));
      return attachMeta(rows);
    },

    /** 可被搜索的番剧数量（非草稿，用于启动时校验索引一致性） */
    async countPublishable() {
      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(animeTable)
        .where(notInArray(animeTable.status, ['draft']));
      return Number(result?.count ?? 0);
    },

    /** 按 ID 游标分批获取搜索索引文档（仅非草稿，供全量重建灌入 meilisearch） */
    async findSearchIndexBatch(afterId: string, limit: number) {
      return db
        .select({
          id: animeTable.id,
          name: animeTable.name,
          seasonName: animeTable.seasonName,
          description: animeTable.description,
          director: animeTable.director,
          cv: animeTable.cv,
          type: animeTable.type,
          status: animeTable.status
        })
        .from(animeTable)
        .where(
          and(
            gt(animeTable.id, afterId),
            notInArray(animeTable.status, ['draft'])
          )
        )
        .orderBy(asc(animeTable.id))
        .limit(limit);
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

      const tagsByAnime = new Map<string, { id: string; name: string }[]>();
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

    /** 按 ID 获取季信息（搜索联想展示季后缀用） */
    async findSeasonByIds(ids: string[]) {
      if (ids.length === 0)
        return new Map<string, { season: number; seasonName: string | null }>();
      const rows = await db
        .select({
          id: animeTable.id,
          season: animeTable.season,
          seasonName: animeTable.seasonName
        })
        .from(animeTable)
        .where(inArray(animeTable.id, ids));
      return new Map(rows.map(r => [r.id, r]));
    },

    /** 查询番剧选项 */
    async findAllOptions() {
      const rows = await db
        .select({
          id: animeTable.id,
          name: animeTable.name,
          season: animeTable.season,
          seasonName: animeTable.seasonName
        })
        .from(animeTable)
        // 草稿未发布，不作为关联选项
        .where(notInArray(animeTable.status, ['draft']))
        .orderBy(asc(animeTable.name));
      return rows.map(r => ({
        label: `${r.name}${buildSeasonSuffix(r.season, r.seasonName)}`,
        value: r.id
      }));
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
    // anime-search 先于本插件加载（其 onReady 全量重建需要本插件，但仅运行时懒访问）
    dependencies: ['db', 'anime-search']
  }
);
