import type { FastifyInstance } from 'fastify';
import { isUniqueViolation } from '../../../../utils/db-errors.js';
import {
  SuccessResponseSchema,
  OptionSchemaResponse
} from '../../../../schemas/common.js';
import {
  type AddAnimeBody,
  AddAnimeSchema,
  type AnimeListQuery,
  AnimeListSchema,
  AnimeListSchemaResponse,
  type UpdateAnimeParams,
  UpdateAnimeParamsSchema,
  type UpdateAnimeBody,
  UpdateAnimeBodySchema
} from '../../../../schemas/anime.js';

export default async function (fastify: FastifyInstance) {
  const {
    authenticate,
    rbac,
    seriesRepository,
    tagsRepository,
    animeRepository,
    httpErrors
  } = fastify;

  /** 创建番剧 */
  fastify.post<{ Body: AddAnimeBody }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        body: AddAnimeSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { seriesId, season, tags, ...rest } = request.body;

      const existingSeries = await seriesRepository.findById(seriesId);
      if (!existingSeries) {
        throw httpErrors.notFound('系列不存在');
      }

      const existingTags = await tagsRepository.findByIds(tags);
      if (existingTags.length !== tags.length) {
        const missingTags = tags.filter(
          id => !existingTags.some(p => p.id === id)
        );
        throw httpErrors.notFound(`标签不存在：${missingTags.join(', ')}`);
      }

      const existingAnime = await animeRepository.findBySeriesAndSeason(
        seriesId,
        season
      );
      if (existingAnime) {
        throw httpErrors.conflict('番剧已存在');
      }

      try {
        await animeRepository.create({ seriesId, season, tags, ...rest });
      } catch (error) {
        // 兼发竞态兑底：预检查通过后仍可能撞唯一索引
        if (isUniqueViolation(error)) {
          throw httpErrors.conflict('该系列下已存在相同季的番剧');
        }
        throw error;
      }
      return reply.success('创建番剧成功');
    }
  );

  /** 番剧列表 */
  fastify.get<{ Querystring: AnimeListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: AnimeListSchema,
        response: {
          200: SuccessResponseSchema(AnimeListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const data = await animeRepository.findAll(request.query);
      return reply.success('获取番剧列表成功', data);
    }
  );

  /** 番剧选项 */
  fastify.get(
    '/options',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        response: {
          200: SuccessResponseSchema(OptionSchemaResponse)
        }
      }
    },
    async (_request, reply) => {
      const data = await animeRepository.findAllOptions();
      return reply.success('获取番剧选项成功', data);
    }
  );

  /** 编辑番剧 */
  fastify.put<{ Params: UpdateAnimeParams; Body: UpdateAnimeBody }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: UpdateAnimeParamsSchema,
        body: UpdateAnimeBodySchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const { seriesId, season, tags, ...rest } = request.body;

      const existingAnime = await animeRepository.findById(id);
      if (!existingAnime) {
        throw httpErrors.notFound('番剧不存在');
      }

      if (seriesId !== undefined) {
        const existingSeries = await seriesRepository.findById(seriesId);
        if (!existingSeries) {
          throw httpErrors.notFound('系列不存在');
        }
      }

      if (tags !== undefined) {
        const existingTags = await tagsRepository.findByIds(tags);
        if (existingTags.length !== tags.length) {
          const missingTags = tags.filter(
            id => !existingTags.some(p => p.id === id)
          );
          throw httpErrors.notFound(`标签不存在：${missingTags.join(', ')}`);
        }
      }

      if (seriesId !== undefined || season !== undefined) {
        const checkSeriesId = seriesId ?? existingAnime.seriesId;
        const checkSeason = season ?? existingAnime.season;
        const duplicate = await animeRepository.findBySeriesAndSeason(
          checkSeriesId,
          checkSeason
        );
        if (duplicate && duplicate.id !== id) {
          throw httpErrors.conflict('该系列下已存在相同季的番剧');
        }
      }

      try {
        await animeRepository.update(id, { seriesId, season, tags, ...rest });
      } catch (error) {
        // 兼发竞态兑底：修改季数时可能撞唯一索引
        if (isUniqueViolation(error)) {
          throw httpErrors.conflict('该系列下已存在相同季的番剧');
        }
        throw error;
      }
      return reply.success('编辑番剧成功');
    }
  );
}
