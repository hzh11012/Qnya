import { z } from 'zod';

/**
 * 仪表盘统计响应 Schema
 */
export const DashboardStatsSchemaResponse = z.object({
  /** 内容概览 */
  content: z.object({
    /** 番剧总数 */
    animeTotal: z.number(),
    /** 各状态番剧数 */
    animeByStatus: z.object({
      draft: z.number(),
      upcoming: z.number(),
      airing: z.number(),
      completed: z.number()
    }),
    /** 各类型番剧数 */
    animeByType: z.object({
      movie: z.number(),
      japanese: z.number(),
      american: z.number(),
      chinese: z.number(),
      adult: z.number()
    }),
    /** 视频总数 */
    videoTotal: z.number(),
    /** 系列总数 */
    seriesTotal: z.number(),
    /** 专题总数 */
    topicTotal: z.number()
  }),
  /** 用户概览 */
  users: z.object({
    /** 用户总数 */
    total: z.number(),
    /** 活跃用户数 (status=true) */
    active: z.number(),
    /** 各角色用户数 */
    byRole: z.object({
      admin: z.number(),
      premium: z.number(),
      user: z.number(),
      guest: z.number()
    })
  }),
  /** 互动数据 */
  interaction: z.object({
    /** 弹幕总数 */
    danmakuTotal: z.number(),
    /** 观看记录总数 */
    historyTotal: z.number(),
    /** 追番总数 */
    collectionTotal: z.number(),
    /** 评分总数 */
    scoreTotal: z.number()
  }),
  /** 任务状态 */
  tasks: z.object({
    /** 待处理 */
    pending: z.number(),
    /** 已完成 */
    completed: z.number()
  }),
  /** 待处理事项 */
  pending: z.object({
    /** 待处理反馈数 */
    feedbacks: z.number()
  }),
  /** 运营数据 — 追番排行 Top 10 */
  topCollections: z.array(
    z.object({
      animeId: z.uuid(),
      animeName: z.string(),
      cover: z.string(),
      count: z.number()
    })
  ),
  /** 运营数据 — 最新反馈 (最近 10 条 pending) */
  recentFeedbacks: z.array(
    z.object({
      id: z.uuid(),
      animeName: z.string(),
      type: z.string(),
      content: z.string(),
      createdAt: z.coerce.date()
    })
  ),
  /** 运营数据 — 最新评分 (最近 10 条) */
  recentScores: z.array(
    z.object({
      id: z.uuid(),
      userName: z.string(),
      animeName: z.string(),
      score: z.number(),
      content: z.string(),
      status: z.boolean(),
      createdAt: z.coerce.date()
    })
  ),
  /** 系统状态 */
  system: z.object({
    database: z.object({
      status: z.enum(['ok', 'error']),
      latency: z.number().optional()
    }),
    redis: z.object({
      status: z.enum(['ok', 'error']),
      latency: z.number().optional()
    })
  })
});

export type DashboardStatsResponse = z.infer<
  typeof DashboardStatsSchemaResponse
>;
