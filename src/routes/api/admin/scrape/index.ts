import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  type ScrapeSearchQuery,
  ScrapeSearchSchema,
  ScrapeSearchSchemaResponse,
  type ScrapeDetailQuery,
  ScrapeDetailSchema,
  ScrapeDetailSchemaResponse
} from '../../../../schemas/scrape.js';
import { mapType, mapMonth } from '../../../../utils/tmdb.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, config, log, httpErrors } = fastify;

  /** 搜索番剧或电影（multi 搜索，无需指定类型） */
  fastify.get<{ Querystring: ScrapeSearchQuery }>(
    '/search',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: ScrapeSearchSchema,
        response: { 200: SuccessResponseSchema(ScrapeSearchSchemaResponse) }
      }
    },
    async (request, reply) => {
      const { query, language } = request.query;

      const url = new URL(`https://${config.TMDB_API_DOMAIN}/3/search/multi`);
      url.searchParams.set('query', query);
      url.searchParams.set('language', language);
      url.searchParams.set('include_adult', 'true');

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${config.TMDB_API_KEY}`,
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        log.error({ status: response.status }, 'search request failed');
        throw httpErrors.internalServerError('搜索失败');
      }

      const data: any = await response.json();

      const items = (data.results ?? [])
        .filter(
          (item: any) => item.media_type === 'tv' || item.media_type === 'movie'
        )
        .slice(0, 10)
        .map((item: any) => {
          const isMovie = item.media_type === 'movie';
          return {
            tmdbId: item.id,
            mediaType: item.media_type as 'tv' | 'movie',
            name: isMovie ? item.title : item.name,
            overview: item.overview ?? '',
            cover: item.poster_path
              ? `https://wsrv.nl/?url=https://${config.TMDB_IMAGE_DOMAIN}/t/p/w342${item.poster_path}`
              : null
          };
        });

      return reply.success('搜索成功', items);
    }
  );

  /** 获取番剧或电影详情 */
  fastify.get<{ Querystring: ScrapeDetailQuery }>(
    '/detail',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: ScrapeDetailSchema,
        response: { 200: SuccessResponseSchema(ScrapeDetailSchemaResponse) }
      }
    },
    async (request, reply) => {
      const { tmdbId, mediaType, language } = request.query;
      const isMovie = mediaType === 'movie';

      // 并行请求：详情 + 演职人员
      const detailUrl = new URL(
        `https://${config.TMDB_API_DOMAIN}/3/${isMovie ? 'movie' : 'tv'}/${tmdbId}`
      );
      detailUrl.searchParams.set('language', language);

      const creditsUrl = new URL(
        `https://${config.TMDB_API_DOMAIN}/3/${isMovie ? 'movie' : 'tv'}/${tmdbId}/credits`
      );
      creditsUrl.searchParams.set('language', language);

      const headers = {
        Authorization: `Bearer ${config.TMDB_API_KEY}`,
        Accept: 'application/json'
      };

      const [detailRes, creditsRes] = await Promise.all([
        fetch(detailUrl.toString(), { headers }),
        fetch(creditsUrl.toString(), { headers })
      ]);

      if (!detailRes.ok) {
        log.error({ status: detailRes.status }, 'detail request failed');
        throw httpErrors.internalServerError('获取详情失败');
      }

      const detail: any = await detailRes.json();
      const credits: any = creditsRes.ok
        ? await creditsRes.json()
        : { crew: [], cast: [] };

      // 导演
      const director =
        (credits.crew ?? [])
          .filter(
            (p: any) => p.job === 'Director' || p.job === 'Series Director'
          )
          .map((p: any) => p.name)
          .join('/') || '';

      // 声优/演员，取前 8 位
      const cv = (credits.cast ?? [])
        .slice(0, 8)
        .map((p: any) => p.name)
        .join('/');

      // 首播日期
      const airDate = isMovie ? detail.release_date : detail.first_air_date;

      const result = {
        name: (isMovie ? detail.title : detail.name) ?? '',
        description: detail.overview ?? '',
        cover: detail.poster_path
          ? `https://wsrv.nl/?url=https://${config.TMDB_IMAGE_DOMAIN}/t/p/w185${detail.poster_path}`
          : null,
        banner: detail.backdrop_path
          ? `https://wsrv.nl/?url=https://${config.TMDB_IMAGE_DOMAIN}/t/p/w342${detail.backdrop_path}`
          : null,
        status: 'draft' as const,
        type: mapType(
          detail.adult ?? false,
          detail.original_language,
          detail.origin_country ??
            detail.production_countries?.map((c: any) => c.iso_3166_1) ??
            [],
          mediaType
        ),
        year: airDate
          ? new Date(airDate).getFullYear()
          : new Date().getFullYear(),
        month: mapMonth(airDate),
        director,
        cv
      };

      return reply.success('获取详情成功', result);
    }
  );
}
