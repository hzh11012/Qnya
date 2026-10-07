import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IdSchema, SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  ClientDanmakuCreateSchema,
  ClientDanmakuItemSchema,
  ClientHistoryCreateSchema,
  ClientPlayDetailSchema,
  ClientRatingCreateSchema,
  type ClientDanmakuCreate,
  type ClientHistoryCreate,
  type ClientPlayParams,
  type ClientRatingCreate
} from '../../../../schemas/play.js';
import { buildSeasonSuffix } from '../../../../utils/season.js';
import type { AnimeType } from '../../../../db/index.js';

/** 展示文案 = 名称 + 季后缀（与搜索/专题/热门一致） */
const withSeasonSuffix = <
  T extends { name: string; season: number; seasonName: string | null }
>(
  item: T
) => ({
  ...item,
  name: item.name + buildSeasonSuffix(item.season, item.seasonName)
});

export default async function (fastify: FastifyInstance) {
  const { authenticate, playRepository } = fastify;

  /** 播放详情 */
  fastify.get<{ Params: ClientPlayParams }>(
    '/:videoId',
    {
      preHandler: [authenticate],
      schema: {
        params: z.object({ videoId: IdSchema }),
        response: { 200: SuccessResponseSchema(ClientPlayDetailSchema) }
      }
    },
    async (request, reply) => {
      const isPrivileged = ['admin', 'premium'].includes(
        request.sessionData!.role
      );
      const excludeTypes = isPrivileged
        ? undefined
        : (['adult'] as AnimeType[]);

      const detail = await playRepository.findDetail(
        request.params.videoId,
        request.sessionData!.userId,
        excludeTypes
      );

      if (!detail) return reply.notFound('视频不存在');

      return reply.success('获取播放详情成功', {
        ...detail,
        name: detail.name + buildSeasonSuffix(detail.season, detail.seasonName),
        series: detail.series.map(withSeasonSuffix),
        recommendations: detail.recommendations.map(withSeasonSuffix)
      });
    }
  );

  /** 播放数 +1 */
  fastify.post<{ Params: ClientPlayParams }>(
    '/:videoId/views',
    {
      preHandler: [authenticate],
      schema: {
        params: z.object({ videoId: IdSchema }),
        response: { 200: SuccessResponseSchema() }
      }
    },
    async request => {
      await playRepository.incrementViews(request.params.videoId);
      return { code: 200, message: '播放数更新成功' };
    }
  );

  /** 弹幕列表 */
  fastify.get<{ Params: ClientPlayParams }>(
    '/:videoId/danmakus',
    {
      preHandler: [authenticate],
      schema: {
        params: z.object({ videoId: IdSchema }),
        response: {
          200: SuccessResponseSchema(
            z.object({ items: z.array(ClientDanmakuItemSchema) })
          )
        }
      }
    },
    async (request, reply) => {
      const items = await playRepository.findDanmakus(request.params.videoId);
      return reply.success('获取弹幕列表成功', { items });
    }
  );

  /** 发送弹幕 */
  fastify.post<{ Params: ClientPlayParams; Body: ClientDanmakuCreate }>(
    '/:videoId/danmakus',
    {
      preHandler: [authenticate],
      schema: {
        params: z.object({ videoId: IdSchema }),
        body: ClientDanmakuCreateSchema,
        response: { 200: SuccessResponseSchema() }
      }
    },
    async (request, reply) => {
      await playRepository.createDanmaku(
        request.params.videoId,
        request.sessionData!.userId,
        request.body
      );
      return reply.success('弹幕发送成功');
    }
  );

  /** 保存观看进度 */
  fastify.post<{ Params: ClientPlayParams; Body: ClientHistoryCreate }>(
    '/:videoId/history',
    {
      preHandler: [authenticate],
      schema: {
        params: z.object({ videoId: IdSchema }),
        body: ClientHistoryCreateSchema,
        response: { 200: SuccessResponseSchema() }
      }
    },
    async (request, reply) => {
      await playRepository.upsertHistory(
        request.params.videoId,
        request.sessionData!.userId,
        request.body
      );
      return reply.success('进度保存成功');
    }
  );

  /** 切换追番状态 */
  fastify.post<{ Params: ClientPlayParams }>(
    '/:videoId/collection',
    {
      preHandler: [authenticate],
      schema: {
        params: z.object({ videoId: IdSchema }),
        response: {
          200: SuccessResponseSchema(z.object({ collected: z.boolean() }))
        }
      }
    },
    async (request, reply) => {
      const video = await playRepository.findAnimeByVideo(
        request.params.videoId
      );
      if (!video) return reply.notFound('视频不存在');

      const collected = await playRepository.toggleCollection(
        video.animeId,
        request.sessionData!.userId
      );
      return reply.success(collected ? '追番成功' : '已取消追番', {
        collected
      });
    }
  );

  /** 提交评分 */
  fastify.post<{ Params: ClientPlayParams; Body: ClientRatingCreate }>(
    '/:videoId/rating',
    {
      preHandler: [authenticate],
      schema: {
        params: z.object({ videoId: IdSchema }),
        body: ClientRatingCreateSchema,
        response: { 200: SuccessResponseSchema() }
      }
    },
    async (request, reply) => {
      const video = await playRepository.findAnimeByVideo(
        request.params.videoId
      );
      if (!video) return reply.notFound('视频不存在');

      await playRepository.createRating(
        video.animeId,
        request.sessionData!.userId,
        request.body
      );
      return reply.success('评分成功');
    }
  );
}
