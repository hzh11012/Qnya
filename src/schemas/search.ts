import { z } from 'zod';
import { IdSchema, PaginationQuerySchema } from './common.js';

export const SearchSuggestQuerySchema = z.object({
  // trim 前置，防止纯空白关键词穿透为全表匹配
  keyword: z.string().trim().min(1).max(50)
});

export type SearchSuggestQuery = z.infer<typeof SearchSuggestQuerySchema>;

export const SearchSuggestItemSchema = z.object({
  name: z.string(),
  highlightName: z.string()
});

export const SearchSuggestResponseSchema = z.array(SearchSuggestItemSchema);

export const SearchListQuerySchema = z.object({
  keyword: z.string().trim().min(1).max(50),
  ...PaginationQuerySchema
});

export type SearchListQuery = z.infer<typeof SearchListQuerySchema>;

const SearchVideoItemSchema = z.object({
  id: IdSchema,
  episode: z.number()
});

export const SearchListItemSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string(),
  cover: z.string(),
  status: z.string(),
  type: z.string(),
  director: z.string(),
  cv: z.string(),
  year: z.number(),
  month: z.string(),
  tags: z.array(z.string()),
  avgScore: z.number(),
  scoreCount: z.number(),
  videoCount: z.number(),
  videoId: IdSchema.nullable(),
  highlightName: z.string(),
  videos: z.array(SearchVideoItemSchema)
});

export const SearchListResponseSchema = z.object({
  items: z.array(SearchListItemSchema),
  total: z.number()
});
