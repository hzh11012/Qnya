import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { AnimeType } from '../../../db/index.js';
import {
  animeTable,
  animeToTagsTable,
  tagsTable,
  videosTable
} from '../../../db/index.js';
import { and, asc, desc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import {
  AddAnimeBody,
  AnimeListQuery,
  UpdateAnimeBody
} from '../../../schemas/anime.js';
import { escapeLike } from '../../../utils/like.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { t2s } from '../../../utils/t2s.js';
import { buildSeasonSuffix } from '../../../utils/season.js';

declare module 'fastify' {
  interface FastifyInstance {
    animeRepository: ReturnType<typeof createAnimeRepository>;
  }
}

const createAnimeRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  /** 名称模糊匹配条件（管理后台列表关键词过滤使用，客户端搜索走 Meilisearch） */
  const nameSearchCondition = (keyword: string) => {
    const simplified = t2s(keyword);
    return sql`(
      ${animeTable.name} ILIKE ${'%' + escapeLike(simplified) + '%'}
      OR ${animeTable.name} ILIKE ${'%' + escapeLike(keyword.toLowerCase()) + '%'}
    )`;
  };

  /** 客户端番剧行类型（与 clientColumns 对齐，供原始 SQL 结果映射） */
  interface ClientAnimeRow {
    id: string;
    name: string;
    season: number;
    seasonName: string | null;
    description: string;
    remark: string;
    cover: string;
    status: string;
    type: string;
    director: string;
    cv: string;
    year: number;
    month: string;
    avgScore: number;
    scoreCount: number;
  }

  /** 客户端搜索结果列 */
  const clientColumns = {
    id: animeTable.id,
    name: animeTable.name,
    season: animeTable.season,
    seasonName: animeTable.seasonName,
    description: animeTable.description,
    remark: animeTable.remark,
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
          .values(animeData)
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
          [updated] = await tx
            .update(animeTable)
            .set(animeData)
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

    /** 热门列表：非草稿，按评分人数降序（并列时评分高者优先，id 稳定分页） */
    async findHot(params: {
      page: number;
      pageSize: number;
      excludeTypes?: AnimeType[];
    }) {
      const { page, pageSize, excludeTypes } = params;

      const conditions = [notInArray(animeTable.status, ['draft'])];
      if (excludeTypes?.length) {
        conditions.push(notInArray(animeTable.type, excludeTypes));
      }
      const whereClause = and(...conditions);

      const [rows, countResult] = await Promise.all([
        db
          .select(clientColumns)
          .from(animeTable)
          .where(whereClause)
          .orderBy(
            desc(animeTable.scoreCount),
            desc(animeTable.avgScore),
            asc(animeTable.id)
          )
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(animeTable)
          .where(whereClause)
      ]);

      const items = await attachMeta(rows);
      return { items, total: Number(countResult[0]?.count ?? 0) };
    },

    /**
     * 猜你喜欢排序：
     *  - 登录用户：兴趣分（标签画像分 + CF 共现分）降序 → 热门度兜底（评分人数/均分）→ md5(id||seed) 稳定随机，
     *    同一 seed 内分页顺序稳定，兴趣分相同的热门优先，避免冷门番永远垫底；
     *  - 游客：md5(id||seed) 纯随机洗牌（seed 分页稳定）。
     * 互动信号权重：观看 3 / 追番 4 / 评分 2。
     */
    async findGuess(params: {
      page: number;
      pageSize: number;
      seed?: string;
      excludeTypes?: AnimeType[];
      userId?: string | null;
    }) {
      const { page, pageSize, seed, excludeTypes, userId } = params;
      const offset = calcOffset(page, pageSize);

      // 过滤条件供 count 查询使用（行查询在原始 SQL 内内联同样的条件）
      const conditions = [notInArray(animeTable.status, ['draft'])];
      if (excludeTypes?.length) {
        conditions.push(notInArray(animeTable.type, excludeTypes));
      }
      const whereClause = and(...conditions);

      // 与客户端列对齐的原始 SQL 查询片段（enum 列转 text 便于映射）
      const clientSelect = sql`
        a.id AS "id",
        a.name AS "name",
        a.season AS "season",
        a.season_name AS "seasonName",
        a.description AS "description",
        a.remark AS "remark",
        a.cover AS "cover",
        a.status::text AS "status",
        a.type::text AS "type",
        a.director AS "director",
        a.cv AS "cv",
        a.year AS "year",
        a.month::text AS "month",
        a.avg_score AS "avgScore",
        a.score_count AS "scoreCount"
      `;

      // 成人内容过滤（enum 与参数比较需转 text；数组参数展开为 IN 列表）
      const excludeSql = excludeTypes?.length
        ? sql` AND a.type::text NOT IN (${sql.join(
            excludeTypes.map(t => sql`${t}`),
            sql`, `
          )})`
        : sql``;

      const result = userId
        ? await db.execute(sql`
            WITH interactions AS (
              SELECT anime_id, ${3}::int AS weight FROM histories WHERE user_id = ${userId}
              UNION ALL
              SELECT anime_id, ${4}::int FROM collections WHERE user_id = ${userId}
              UNION ALL
              SELECT anime_id, ${2}::int FROM scores WHERE user_id = ${userId}
            ),
            user_tags AS (
              SELECT att.tag_id, sum(i.weight) AS weight
              FROM interactions i
              JOIN anime_to_tags att ON att.anime_id = i.anime_id
              GROUP BY att.tag_id
            ),
            watched AS (
              SELECT anime_id, max(weight) AS weight FROM interactions GROUP BY anime_id
            ),
            user_cf AS (
              SELECT af.related_anime_id AS anime_id, sum(af.score * w.weight) AS score
              FROM watched w
              JOIN anime_affinity af ON af.anime_id = w.anime_id
              GROUP BY af.related_anime_id
            ),
            candidates AS (
              SELECT
                a.id,
                coalesce(sum(ut.weight), 0)::int AS tag_score,
                coalesce(max(cf.score), 0)::int AS cf_score
              FROM anime a
              LEFT JOIN anime_to_tags att ON att.anime_id = a.id
              LEFT JOIN user_tags ut ON ut.tag_id = att.tag_id
              LEFT JOIN user_cf cf ON cf.anime_id = a.id
              WHERE a.status::text <> 'draft' ${excludeSql}
              GROUP BY a.id
            )
            SELECT ${clientSelect}, c.tag_score + c.cf_score AS interest
            FROM anime a
            JOIN candidates c ON c.id = a.id
            ORDER BY
              (c.tag_score + c.cf_score) DESC,
              a.score_count DESC,
              a.avg_score DESC,
              md5(a.id::text || ${seed ?? ''})
            LIMIT ${pageSize} OFFSET ${offset}
          `)
        : await db.execute(sql`
            SELECT ${clientSelect}
            FROM anime a
            WHERE a.status::text <> 'draft' ${excludeSql}
            ORDER BY md5(a.id::text || ${seed ?? ''})
            LIMIT ${pageSize} OFFSET ${offset}
          `);

      const rows = result.rows as unknown as ClientAnimeRow[];

      const items = await attachMeta(rows);

      // count 沿用原查询条件（与排序无关）
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(animeTable)
        .where(whereClause);
      return { items, total: Number(countResult[0]?.count ?? 0) };
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
