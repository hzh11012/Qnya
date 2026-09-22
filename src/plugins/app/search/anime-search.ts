import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Index } from 'meilisearch';
import type { AnimeType } from '../../../db/index.js';
import { toInitials, toPinyin, toSpacedPinyin } from '../../../utils/pinyin.js';

declare module 'fastify' {
  interface FastifyInstance {
    animeSearch: ReturnType<typeof createAnimeSearch>;
  }
}

const ANIME_INDEX = 'anime';
/** 全量重建时的批次大小 */
const REINDEX_BATCH_SIZE = 500;
/** meilisearch 单次查询返回上限 */
const MEILI_MAX_PAGE_SIZE = 1000;

/** 搜索文档结构（meilisearch 索引字段，拼音由 name 在索引时派生） */
interface AnimeSearchDoc {
  id: string;
  name: string;
  seasonName: string;
  namePinyin: string;
  /** 空格分隔的全拼（按音节切词，支持音节级检索） */
  namePinyinSpaced: string;
  nameInitials: string;
  description: string;
  director: string;
  cv: string;
  type: AnimeType;
}

const createAnimeSearch = (fastify: FastifyInstance) => {
  const index: Index<AnimeSearchDoc> = fastify.meili.index(ANIME_INDEX);

  /** 构建 type 排除过滤条件 */
  const excludeFilter = (excludeTypes?: AnimeType[]) =>
    excludeTypes?.length
      ? `NOT (type IN [${excludeTypes.map(t => JSON.stringify(t)).join(', ')}])`
      : undefined;

  /** 只保留索引需要的字段，拼音统一由 name + seasonName 在索引时派生 */
  const toDoc = (a: {
    id: string;
    name: string;
    seasonName: string | null;
    description: string;
    director: string;
    cv: string;
    type: AnimeType;
  }): AnimeSearchDoc => {
    // 名称 + 季名拼接（拼音派生基准，季名缺失时与纯名称等价）
    const fullName = [a.name, a.seasonName].filter(Boolean).join(' ');

    return {
      id: a.id,
      name: a.name,
      seasonName: a.seasonName ?? '',
      namePinyin: toPinyin(fullName),
      namePinyinSpaced: toSpacedPinyin(fullName),
      nameInitials: toInitials(fullName),
      description: a.description,
      director: a.director,
      cv: a.cv,
      type: a.type
    };
  };

  /** 同步索引设置（幂等，meilisearch 升级或人工误改后可自愈） */
  const ensureSettings = async () => {
    const task = await index.updateSettings({
      // 顺序即相关度权重：名称 > 季名 > 全拼 > 音节拼音 > 首字母
      // 只搜名称/季名及其拼音：与拼音搜索范围保持一致，
      // 避免中文单字在导演/声优/简介中产生大量低相关结果
      searchableAttributes: [
        'name',
        'seasonName',
        'namePinyin',
        'namePinyinSpaced',
        'nameInitials'
      ],
      filterableAttributes: ['type']
      // 排序使用官方默认规则（words > typo > proximity > attribute > sort > exactness），
      // 自带错别字容错，无需额外配置
    });
    await fastify.meili.tasks.waitForTask(task.taskUid, { timeout: 60_000 });
  };

  /** 全量重建索引：先清空，再从 PostgreSQL 分批灌入（仅非草稿） */
  const rebuild = async () => {
    const repo = fastify.animeRepository;

    await ensureSettings();
    await index.deleteAllDocuments();

    // uuid 游标哨兵：nil uuid 小于一切 uuidv4/v7，作为第一页的起始游标
    const NIL_UUID = '00000000-0000-0000-0000-000000000000';
    let lastId = NIL_UUID;
    for (;;) {
      const rows = await repo.findSearchIndexBatch(lastId, REINDEX_BATCH_SIZE);
      if (rows.length === 0) break;

      const task = await index.addDocuments(rows.map(toDoc), {
        primaryKey: 'id'
      });
      await fastify.meili.tasks.waitForTask(task.taskUid, {
        timeout: 120_000
      });

      lastId = rows[rows.length - 1]!.id;
      if (rows.length < REINDEX_BATCH_SIZE) break;
    }

    const stats = await index.getStats();
    fastify.log.info(
      `Anime search index rebuilt (${stats.numberOfDocuments} docs)`
    );
  };

  return {
    /** 搜索建议（高亮由路由层基于名称 + 季信息计算） */
    async suggest(keyword: string, excludeTypes?: AnimeType[]) {
      const res = await index.search(keyword, {
        limit: 10,
        attributesToRetrieve: ['id', 'name'],
        filter: excludeFilter(excludeTypes)
      });
      return res.hits.map(h => ({
        id: h.id,
        name: h.name
      }));
    },

    /** 搜索列表：meilisearch 负责检索与排序，标签/视频信息由 PostgreSQL 按 ID 水合 */
    async search(
      keyword: string,
      page: number,
      pageSize: number,
      excludeTypes?: AnimeType[]
    ) {
      const res = await index.search(keyword, {
        hitsPerPage: Math.min(pageSize, MEILI_MAX_PAGE_SIZE),
        page,
        attributesToRetrieve: ['id'],
        filter: excludeFilter(excludeTypes)
      });

      const ids = res.hits.map(h => h.id);
      const rows = await fastify.animeRepository.findByIdsWithMeta(ids);

      // 保持 meilisearch 返回的相关度顺序
      const byId = new Map(rows.map(r => [r.id, r]));
      const items = ids
        .map(id => byId.get(id))
        .filter(item => item !== undefined);

      return { items, total: res.totalHits ?? items.length };
    },

    /** 增删改后同步单条番剧到索引（草稿不入索引） */
    async syncAnime(anime: {
      id: string;
      name: string;
      seasonName: string | null;
      description: string;
      director: string;
      cv: string;
      type: AnimeType;
      status: string;
    }) {
      if (anime.status === 'draft') {
        await this.removeAnime(anime.id);
        return;
      }
      try {
        // 不等待任务完成，meilisearch 异步处理，最终一致即可
        await index.addDocuments([toDoc(anime)], { primaryKey: 'id' });
      } catch (err) {
        // 数据库是唯一事实来源：同步失败不阻塞写操作，
        // 由启动时的一致性校验或管理端全量重建自愈
        fastify.log.warn(
          { err, animeId: anime.id },
          'Anime search index sync failed'
        );
      }
    },

    /** 从索引移除番剧（删除或回退为草稿时调用） */
    async removeAnime(id: string) {
      try {
        await index.deleteDocuments([id]);
      } catch (err) {
        fastify.log.warn(
          { err, animeId: id },
          'Anime search index remove failed'
        );
      }
    },

    /** 手动全量重建（管理端接口使用） */
    async reindexAll() {
      return rebuild();
    },

    /** 同步索引设置（启动时调用，幂等） */
    async ensureSettings() {
      return ensureSettings();
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const service = createAnimeSearch(fastify);
    fastify.decorate('animeSearch', service);

    // 启动时确保索引存在、同步索引设置（幂等，设置变更可自愈），
    // 并校验索引与数据库的一致性，不一致则全量重建；
    // 校验失败同样阻止启动（搜索为必选依赖）
    fastify.addHook('onReady', async () => {
      await service.ensureSettings();

      const dbCount = await fastify.animeRepository.countPublishable();

      // 全新 meilisearch 实例上索引尚不存在
      const searchIndex = fastify.meili.index(ANIME_INDEX);
      const stats = await searchIndex.getStats().catch(() => null);
      if (!stats) {
        fastify.log.info(`Creating anime search index (${ANIME_INDEX})...`);
        const task = await fastify.meili.createIndex(ANIME_INDEX, {
          primaryKey: 'id'
        });
        await fastify.meili.tasks.waitForTask(task.taskUid, {
          timeout: 60_000
        });
      }

      const count = stats ? stats.numberOfDocuments : 0;
      if (count === dbCount) return;

      fastify.log.info(
        `Anime search index out of sync (index=${count}, db=${dbCount}), rebuilding...`
      );
      await service.reindexAll();
    });
  },
  {
    name: 'anime-search',
    dependencies: ['db', 'meilisearch']
  }
);
