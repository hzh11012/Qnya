DROP INDEX "anime_name_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anime_name_trgm_idx" ON "anime" USING gin ("name" gin_trgm_ops);