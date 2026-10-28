import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { mapType, mapMonth } from '../../../../utils/tmdb.js';

export function registerGetTmdbDetail(
  server: McpServer,
  fastify: FastifyInstance
) {
  const { config } = fastify;

  server.registerTool(
    'get_tmdb_detail',
    {
      description:
        '获取 TMDB 动漫或电影详情。' +
        '【TV 不传 season】返回系列基础信息和 seasons 列表，用于了解共有几季及各季编号；' +
        '【TV 传 season】返回该季专属数据（名称、简介、封面、首播日期、导演、声优）及 episodes 剧集列表（编号/标题/播出日期/类型），可用于规划 create_video 的集数。特别篇通常在 season 0。' +
        '推荐工作流：先不传 season 获取季列表，再按需逐季传 season 获取详情，最后调用 create_anime 入库。',
      inputSchema: {
        tmdbId: z.number().describe('TMDB ID'),
        mediaType: z.enum(['tv', 'movie']).describe('媒体类型'),
        season: z
          .number()
          .optional()
          .describe(
            '季编号（仅 TV 有效，0 为特别篇合集）。不传时返回系列信息和季列表；传入时返回该季专属详情及剧集列表'
          ),
        language: z.string().optional().default('zh-CN').describe('语言代码')
      }
    },
    async ({ tmdbId, mediaType, language, season }) => {
      const isMovie = mediaType === 'movie';
      const lang = language ?? 'zh-CN';
      const headers = {
        Authorization: `Bearer ${config.TMDB_API_KEY}`,
        Accept: 'application/json'
      };

      const buildUrl = (path: string) => {
        const url = new URL(`https://${config.TMDB_API_DOMAIN}${path}`);
        url.searchParams.set('language', lang);
        return url.toString();
      };

      if (isMovie) {
        const [detailRes, creditsRes] = await Promise.all([
          fetch(buildUrl(`/3/movie/${tmdbId}`), { headers }),
          fetch(buildUrl(`/3/movie/${tmdbId}/credits`), { headers })
        ]);

        if (!detailRes.ok)
          return {
            content: [
              { type: 'text', text: `获取详情失败: ${detailRes.status}` }
            ],
            isError: true
          };

        const detail: any = await detailRes.json();
        const credits: any = creditsRes.ok
          ? await creditsRes.json()
          : { crew: [], cast: [] };

        const director =
          (credits.crew ?? [])
            .filter((p: any) => p.job === 'Director')
            .map((p: any) => p.name)
            .join('/') || '未知';
        const cv =
          (credits.cast ?? [])
            .slice(0, 8)
            .map((p: any) => p.name)
            .join('/') || '未知';

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  name: detail.title ?? '',
                  description: detail.overview ?? '暂无简介',
                  cover: detail.poster_path
                    ? `https://${config.TMDB_IMAGE_DOMAIN}/t/p/w342${detail.poster_path}`
                    : '',
                  banner: detail.backdrop_path
                    ? `https://${config.TMDB_IMAGE_DOMAIN}/t/p/w500${detail.backdrop_path}`
                    : '',
                  type: mapType(
                    detail.adult ?? false,
                    detail.original_language,
                    detail.production_countries?.map(
                      (c: any) => c.iso_3166_1
                    ) ?? [],
                    mediaType
                  ),
                  year: detail.release_date
                    ? new Date(detail.release_date).getFullYear()
                    : new Date().getFullYear(),
                  month: mapMonth(detail.release_date),
                  director,
                  cv
                },
                null,
                2
              )
            }
          ]
        };
      }

      // TV：先取系列信息（必须），季详情和季演职员按需并行
      const requests: Promise<Response>[] = [
        fetch(buildUrl(`/3/tv/${tmdbId}`), { headers })
      ];
      if (season != null) {
        requests.push(
          fetch(buildUrl(`/3/tv/${tmdbId}/season/${season}`), { headers }),
          fetch(buildUrl(`/3/tv/${tmdbId}/season/${season}/credits`), {
            headers
          })
        );
      }

      const [seriesRes, seasonRes, creditsRes] = await Promise.all(requests);

      if (!seriesRes.ok)
        return {
          content: [
            { type: 'text', text: `获取详情失败: ${seriesRes.status}` }
          ],
          isError: true
        };

      const series: any = await seriesRes.json();

      // 不传 season：返回系列基础信息 + 季列表，让调用方了解有几季
      if (season == null) {
        const seasons = (series.seasons ?? [])
          .filter((s: any) => s.season_number > 0)
          .map((s: any) => ({
            season_number: s.season_number,
            name: s.name,
            air_date: s.air_date,
            episode_count: s.episode_count
          }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  name: series.name ?? '',
                  type: mapType(
                    series.adult ?? false,
                    series.original_language,
                    series.origin_country ?? [],
                    mediaType
                  ),
                  banner: series.backdrop_path
                    ? `https://${config.TMDB_IMAGE_DOMAIN}/t/p/w500${series.backdrop_path}`
                    : '',
                  seasons
                },
                null,
                2
              )
            }
          ]
        };
      }

      // 传了 season：返回该季专属详情
      const seasonDetail: any =
        seasonRes && seasonRes.ok ? await seasonRes.json() : null;
      const credits: any =
        creditsRes && creditsRes.ok
          ? await creditsRes.json()
          : { crew: [], cast: [] };

      const airDate = seasonDetail?.air_date || series.first_air_date;
      const posterPath = seasonDetail?.poster_path || series.poster_path;

      const director =
        (credits.crew ?? [])
          .filter(
            (p: any) => p.job === 'Director' || p.job === 'Series Director'
          )
          .map((p: any) => p.name)
          .join('/') || '未知';
      const cv =
        (credits.cast ?? [])
          .slice(0, 8)
          .map((p: any) => p.name)
          .join('/') || '未知';

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                name: seasonDetail?.name || series.name || '',
                description:
                  seasonDetail?.overview || series.overview || '暂无简介',
                cover: posterPath
                  ? `https://${config.TMDB_IMAGE_DOMAIN}/t/p/w342${posterPath}`
                  : '',
                banner: series.backdrop_path
                  ? `https://${config.TMDB_IMAGE_DOMAIN}/t/p/w500${series.backdrop_path}`
                  : '',
                type: mapType(
                  series.adult ?? false,
                  series.original_language,
                  series.origin_country ?? [],
                  mediaType
                ),
                year: airDate
                  ? new Date(airDate).getFullYear()
                  : new Date().getFullYear(),
                month: mapMonth(airDate),
                director,
                cv,
                episodes: (seasonDetail?.episodes ?? []).map((e: any) => ({
                  episode_number: e.episode_number,
                  name: e.name ?? '',
                  air_date: e.air_date ?? null,
                  episode_type: e.episode_type ?? null,
                  runtime: e.runtime ?? null
                }))
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
