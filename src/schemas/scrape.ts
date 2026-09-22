import { z } from 'zod';

export const MediaTypeSchema = z.enum(['tv', 'movie']);

export const ScrapeSearchSchema = z.object({
  query: z.string().min(1).max(100),
  language: z.string().optional().default('zh-CN')
});

export type ScrapeSearchQuery = z.infer<typeof ScrapeSearchSchema>;

export const ScrapeSearchItemSchema = z.object({
  tmdbId: z.number(),
  mediaType: MediaTypeSchema,
  name: z.string(),
  overview: z.string(),
  cover: z.string().nullable()
});

export const ScrapeSearchSchemaResponse = z.array(ScrapeSearchItemSchema);

export const ScrapeDetailSchema = z.object({
  tmdbId: z.coerce.number().int().min(1),
  mediaType: MediaTypeSchema.default('tv'),
  season: z.coerce.number().min(1).optional().default(1),
  language: z.string().optional().default('zh-CN')
});

export type ScrapeDetailQuery = z.infer<typeof ScrapeDetailSchema>;

export const ScrapeDetailSchemaResponse = z.object({
  name: z.string(),
  description: z.string(),
  cover: z.string().nullable(),
  banner: z.string().nullable(),
  status: z.enum(['draft', 'upcoming', 'airing', 'completed']),
  type: z.enum(['movie', 'japanese', 'american', 'chinese', 'adult']),
  year: z.number(),
  month: z.enum(['january', 'april', 'july', 'october']),
  director: z.string(),
  cv: z.string()
});
