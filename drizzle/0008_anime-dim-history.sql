-- 历史记录改为动漫维度：同一用户对同一动漫仅一条记录
-- 迁移策略：删除旧约束 → 加 anime_id 列并从 videos 回填 → 去重（仅保留每组最后观看的一条）→ 建约束

ALTER TABLE "histories" DROP CONSTRAINT "histories_user_video_unique";--> statement-breakpoint
DROP INDEX "histories_user_id_idx";--> statement-breakpoint
DROP INDEX "histories_video_id_idx";--> statement-breakpoint
ALTER TABLE "histories" ADD COLUMN "anime_id" uuid;--> statement-breakpoint
UPDATE "histories" SET "anime_id" = v."anime_id" FROM "videos" v WHERE v."id" = "histories"."video_id";--> statement-breakpoint
-- 同一 (user_id, anime_id) 仅保留 updated_at 最新的一条
DELETE FROM "histories" h
USING "histories" kept
WHERE h."user_id" = kept."user_id"
  AND h."anime_id" = kept."anime_id"
  AND (
    h."updated_at" < kept."updated_at"
    OR (h."updated_at" = kept."updated_at" AND h."id" < kept."id")
  );--> statement-breakpoint
ALTER TABLE "histories" ALTER COLUMN "anime_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "histories" ADD CONSTRAINT "histories_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "histories" ADD CONSTRAINT "histories_user_anime_unique" UNIQUE("user_id","anime_id");
