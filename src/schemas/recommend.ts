import { z } from 'zod';

/** 推荐系统状态响应 */
export const RecommendStatusResponseSchema = z.object({
  /** 共现矩阵最近一次重建时间（从未重建为 null） */
  lastRefreshedAt: z.date().nullable(),
  /** 亲和记录条数 */
  affinityCount: z.number(),
  /** 可推荐番剧数（非草稿） */
  animeCount: z.number()
});

export type RecommendStatusResponse = z.infer<
  typeof RecommendStatusResponseSchema
>;
