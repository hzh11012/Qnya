import type { FastifyInstance } from 'fastify';
import { isUniqueViolation } from '../../../../utils/db-errors.js';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  type VideoListQuery,
  VideoListSchema,
  VideoListSchemaResponse,
  type AddVideoBody,
  AddVideoSchema,
  type UpdateVideoParams,
  UpdateVideoParamsSchema,
  type UpdateVideoBody,
  UpdateVideoBodySchema,
  type DeleteVideoParams,
  DeleteVideoParamsSchema
} from '../../../../schemas/videos.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, videosRepository, animeRepository, httpErrors } =
    fastify;

  /** 创建剧集 */
  fastify.post<{ Body: AddVideoBody }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        body: AddVideoSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { animeId, episode } = request.body;

      const anime = await animeRepository.findById(animeId);
      if (!anime) {
        throw httpErrors.notFound('动漫不存在');
      }

      const existingVideo = await videosRepository.findByAnimeIdAndEpisode(
        animeId,
        episode
      );
      if (existingVideo) {
        throw httpErrors.conflict('该番剧已存在相同集数的剧集');
      }

      try {
        await videosRepository.create(request.body);
      } catch (error) {
        // 兼发竞态兑底：预检查通过后仍可能撞唯一索引
        if (isUniqueViolation(error)) {
          throw httpErrors.conflict('该番剧已存在相同集数的剧集');
        }
        throw error;
      }
      return reply.success('创建剧集成功');
    }
  );

  /** 获取剧集列表 */
  fastify.get<{ Querystring: VideoListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: VideoListSchema,
        response: {
          200: SuccessResponseSchema(VideoListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const data = await videosRepository.findAll(request.query);
      return reply.success('获取剧集列表成功', data);
    }
  );

  /** 编辑剧集 */
  fastify.put<{ Params: UpdateVideoParams; Body: UpdateVideoBody }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: UpdateVideoParamsSchema,
        body: UpdateVideoBodySchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const existingVideo = await videosRepository.findById(id);
      if (!existingVideo) {
        throw httpErrors.notFound('剧集不存在');
      }

      if (request.body.animeId !== undefined) {
        const anime = await animeRepository.findById(request.body.animeId);
        if (!anime) {
          throw httpErrors.notFound('动漫不存在');
        }
      }

      // 检查是否有重复的 animeId + episode 组合
      const checkAnimeId = request.body.animeId ?? existingVideo.animeId;
      const checkEpisode = request.body.episode ?? existingVideo.episode;

      // 只有当 animeId 或 episode 发生变化时才检查重复
      if (
        request.body.animeId !== undefined ||
        request.body.episode !== undefined
      ) {
        const duplicateVideo = await videosRepository.findByAnimeIdAndEpisode(
          checkAnimeId,
          checkEpisode
        );
        if (duplicateVideo && duplicateVideo.id !== id) {
          throw httpErrors.conflict('该动漫已存在相同集数的剧集');
        }
      }

      try {
        await videosRepository.update(id, request.body);
      } catch (error) {
        // 兼发竞态兑底：修改集数时可能撞唯一索引
        if (isUniqueViolation(error)) {
          throw httpErrors.conflict('该番剧已存在相同集数的剧集');
        }
        throw error;
      }
      return reply.success('编辑剧集成功');
    }
  );

  /** 删除剧集 */
  fastify.delete<{ Params: DeleteVideoParams }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: DeleteVideoParamsSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const deleted = await videosRepository.deleteById(id);
      if (!deleted) {
        throw httpErrors.notFound('剧集不存在');
      }

      return reply.success('删除剧集成功');
    }
  );
}
