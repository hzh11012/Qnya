-- 整库主键迁移：integer 自增 ID → UUID
-- 策略：旧数据用 gen_random_uuid()（v4）回填；应用层新数据用 uuidv7（时间有序）
-- 三阶段执行：加新列并回填 → 删旧约束/列并重命名 → 重建主键/外键/唯一约束/索引

-- ========== 阶段一：新增 uuid 列并回填 ==========

-- 各表主键
ALTER TABLE "anime" ADD COLUMN "id_new" uuid;--> statement-breakpoint
UPDATE "anime" SET "id_new" = gen_random_uuid();--> statement-breakpoint
ALTER TABLE "anime" ALTER COLUMN "id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "id_new" uuid;--> statement-breakpoint
UPDATE "collections" SET "id_new" = gen_random_uuid();--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "danmaku" ADD COLUMN "id_new" uuid;--> statement-breakpoint
UPDATE "danmaku" SET "id_new" = gen_random_uuid();--> statement-breakpoint
ALTER TABLE "danmaku" ALTER COLUMN "id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "id_new" uuid;--> statement-breakpoint
UPDATE "feedback" SET "id_new" = gen_random_uuid();--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "histories" ADD COLUMN "id_new" uuid;--> statement-breakpoint
UPDATE "histories" SET "id_new" = gen_random_uuid();--> statement-breakpoint
ALTER TABLE "histories" ALTER COLUMN "id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "id_new" uuid;--> statement-breakpoint
UPDATE "scores" SET "id_new" = gen_random_uuid();--> statement-breakpoint
ALTER TABLE "scores" ALTER COLUMN "id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "id_new" uuid;--> statement-breakpoint
UPDATE "series" SET "id_new" = gen_random_uuid();--> statement-breakpoint
ALTER TABLE "series" ALTER COLUMN "id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "id_new" uuid;--> statement-breakpoint
UPDATE "tags" SET "id_new" = gen_random_uuid();--> statement-breakpoint
ALTER TABLE "tags" ALTER COLUMN "id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "id_new" uuid;--> statement-breakpoint
UPDATE "topics" SET "id_new" = gen_random_uuid();--> statement-breakpoint
ALTER TABLE "topics" ALTER COLUMN "id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "id_new" uuid;--> statement-breakpoint
UPDATE "users" SET "id_new" = gen_random_uuid();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "id_new" uuid;--> statement-breakpoint
UPDATE "videos" SET "id_new" = gen_random_uuid();--> statement-breakpoint
ALTER TABLE "videos" ALTER COLUMN "id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "id_new" uuid;--> statement-breakpoint
UPDATE "tasks" SET "id_new" = gen_random_uuid();--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "id_new" SET NOT NULL;--> statement-breakpoint

-- 关联表（anime_to_tags / anime_to_topics）
ALTER TABLE "anime_to_tags" ADD COLUMN "anime_id_new" uuid;--> statement-breakpoint
ALTER TABLE "anime_to_tags" ADD COLUMN "tag_id_new" uuid;--> statement-breakpoint
ALTER TABLE "anime_to_topics" ADD COLUMN "anime_id_new" uuid;--> statement-breakpoint
ALTER TABLE "anime_to_topics" ADD COLUMN "topic_id_new" uuid;--> statement-breakpoint

-- 外键列回填（通过旧整数 ID 关联映射到新 uuid）
UPDATE "anime_to_tags" SET "anime_id_new" = a."id_new" FROM "anime" a WHERE "anime_to_tags"."anime_id" = a."id";--> statement-breakpoint
UPDATE "anime_to_tags" SET "tag_id_new" = t."id_new" FROM "tags" t WHERE "anime_to_tags"."tag_id" = t."id";--> statement-breakpoint
UPDATE "anime_to_topics" SET "anime_id_new" = a."id_new" FROM "anime" a WHERE "anime_to_topics"."anime_id" = a."id";--> statement-breakpoint
UPDATE "anime_to_topics" SET "topic_id_new" = t."id_new" FROM "topics" t WHERE "anime_to_topics"."topic_id" = t."id";--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "series_id_new" uuid;--> statement-breakpoint
UPDATE "anime" SET "series_id_new" = s."id_new" FROM "series" s WHERE "anime"."series_id" = s."id";--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "user_id_new" uuid;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "anime_id_new" uuid;--> statement-breakpoint
UPDATE "collections" SET "user_id_new" = u."id_new" FROM "users" u WHERE "collections"."user_id" = u."id";--> statement-breakpoint
UPDATE "collections" SET "anime_id_new" = a."id_new" FROM "anime" a WHERE "collections"."anime_id" = a."id";--> statement-breakpoint
ALTER TABLE "danmaku" ADD COLUMN "user_id_new" uuid;--> statement-breakpoint
UPDATE "danmaku" SET "user_id_new" = u."id_new" FROM "users" u WHERE "danmaku"."user_id" = u."id";--> statement-breakpoint
ALTER TABLE "danmaku" ADD COLUMN "video_id_new" uuid;--> statement-breakpoint
UPDATE "danmaku" SET "video_id_new" = v."id_new" FROM "videos" v WHERE "danmaku"."video_id" = v."id";--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "user_id_new" uuid;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "anime_id_new" uuid;--> statement-breakpoint
UPDATE "feedback" SET "user_id_new" = u."id_new" FROM "users" u WHERE "feedback"."user_id" = u."id";--> statement-breakpoint
UPDATE "feedback" SET "anime_id_new" = a."id_new" FROM "anime" a WHERE "feedback"."anime_id" = a."id";--> statement-breakpoint
ALTER TABLE "histories" ADD COLUMN "user_id_new" uuid;--> statement-breakpoint
UPDATE "histories" SET "user_id_new" = u."id_new" FROM "users" u WHERE "histories"."user_id" = u."id";--> statement-breakpoint
ALTER TABLE "histories" ADD COLUMN "video_id_new" uuid;--> statement-breakpoint
UPDATE "histories" SET "video_id_new" = v."id_new" FROM "videos" v WHERE "histories"."video_id" = v."id";--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "user_id_new" uuid;--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "anime_id_new" uuid;--> statement-breakpoint
UPDATE "scores" SET "user_id_new" = u."id_new" FROM "users" u WHERE "scores"."user_id" = u."id";--> statement-breakpoint
UPDATE "scores" SET "anime_id_new" = a."id_new" FROM "anime" a WHERE "scores"."anime_id" = a."id";--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "anime_id_new" uuid;--> statement-breakpoint
UPDATE "videos" SET "anime_id_new" = a."id_new" FROM "anime" a WHERE "videos"."anime_id" = a."id";--> statement-breakpoint

ALTER TABLE "anime_to_tags" ALTER COLUMN "anime_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "anime_to_tags" ALTER COLUMN "tag_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "anime_to_topics" ALTER COLUMN "anime_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "anime_to_topics" ALTER COLUMN "topic_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "user_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "anime_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "danmaku" ALTER COLUMN "user_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "danmaku" ALTER COLUMN "video_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "user_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "anime_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "histories" ALTER COLUMN "user_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "histories" ALTER COLUMN "video_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scores" ALTER COLUMN "user_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scores" ALTER COLUMN "anime_id_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ALTER COLUMN "anime_id_new" SET NOT NULL;--> statement-breakpoint

-- ========== 阶段二：删除旧约束/旧列，重命名新列 ==========

-- 删除外键约束
ALTER TABLE "anime_to_tags" DROP CONSTRAINT "anime_to_tags_anime_id_anime_id_fk";--> statement-breakpoint
ALTER TABLE "anime_to_tags" DROP CONSTRAINT "anime_to_tags_tag_id_tags_id_fk";--> statement-breakpoint
ALTER TABLE "anime_to_topics" DROP CONSTRAINT "anime_to_topics_anime_id_anime_id_fk";--> statement-breakpoint
ALTER TABLE "anime_to_topics" DROP CONSTRAINT "anime_to_topics_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "anime" DROP CONSTRAINT "anime_series_id_series_id_fk";--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT "collections_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT "collections_anime_id_anime_id_fk";--> statement-breakpoint
ALTER TABLE "danmaku" DROP CONSTRAINT "danmaku_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "danmaku" DROP CONSTRAINT "danmaku_video_id_videos_id_fk";--> statement-breakpoint
ALTER TABLE "feedback" DROP CONSTRAINT "feedback_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "feedback" DROP CONSTRAINT "feedback_anime_id_anime_id_fk";--> statement-breakpoint
ALTER TABLE "histories" DROP CONSTRAINT "histories_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "histories" DROP CONSTRAINT "histories_video_id_videos_id_fk";--> statement-breakpoint
ALTER TABLE "scores" DROP CONSTRAINT "scores_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "scores" DROP CONSTRAINT "scores_anime_id_anime_id_fk";--> statement-breakpoint
ALTER TABLE "videos" DROP CONSTRAINT "videos_anime_id_anime_id_fk";--> statement-breakpoint

-- 删除包含旧整数列的唯一约束
ALTER TABLE "anime_to_tags" DROP CONSTRAINT "anime_to_tags_anime_id_tag_id_pk";--> statement-breakpoint
ALTER TABLE "anime_to_topics" DROP CONSTRAINT "anime_to_topics_anime_id_topic_id_pk";--> statement-breakpoint
ALTER TABLE "anime" DROP CONSTRAINT "anime_series_season_unique";--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT "collections_user_anime_unique";--> statement-breakpoint
ALTER TABLE "histories" DROP CONSTRAINT "histories_user_video_unique";--> statement-breakpoint
ALTER TABLE "scores" DROP CONSTRAINT "scores_user_anime_unique";--> statement-breakpoint
ALTER TABLE "videos" DROP CONSTRAINT "videos_anime_episode_unique";--> statement-breakpoint

-- 删除包含旧整数列的索引
DROP INDEX "anime_series_id_idx";--> statement-breakpoint
DROP INDEX "collections_user_id_idx";--> statement-breakpoint
DROP INDEX "collections_anime_id_idx";--> statement-breakpoint
DROP INDEX "danmaku_user_id_idx";--> statement-breakpoint
DROP INDEX "danmaku_video_id_idx";--> statement-breakpoint
DROP INDEX "feedback_user_id_idx";--> statement-breakpoint
DROP INDEX "feedback_anime_id_idx";--> statement-breakpoint
DROP INDEX "histories_user_id_idx";--> statement-breakpoint
DROP INDEX "histories_video_id_idx";--> statement-breakpoint
DROP INDEX "scores_user_id_idx";--> statement-breakpoint
DROP INDEX "scores_anime_id_idx";--> statement-breakpoint
DROP INDEX "videos_anime_id_idx";--> statement-breakpoint
DROP INDEX "anime_to_tags_anime_id_idx";--> statement-breakpoint
DROP INDEX "anime_to_tags_tag_id_idx";--> statement-breakpoint
DROP INDEX "anime_to_topics_anime_id_idx";--> statement-breakpoint
DROP INDEX "anime_to_topics_topic_id_idx";--> statement-breakpoint

-- 删除旧主键约束与旧列，重命名新列
ALTER TABLE "anime" DROP CONSTRAINT "anime_pkey";--> statement-breakpoint
ALTER TABLE "anime" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "anime" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "anime" DROP COLUMN "series_id";--> statement-breakpoint
ALTER TABLE "anime" RENAME COLUMN "series_id_new" TO "series_id";--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT "collections_pkey";--> statement-breakpoint
ALTER TABLE "collections" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "collections" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "collections" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "collections" RENAME COLUMN "user_id_new" TO "user_id";--> statement-breakpoint
ALTER TABLE "collections" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "collections" RENAME COLUMN "anime_id_new" TO "anime_id";--> statement-breakpoint
ALTER TABLE "danmaku" DROP CONSTRAINT "danmaku_pkey";--> statement-breakpoint
ALTER TABLE "danmaku" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "danmaku" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "danmaku" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "danmaku" RENAME COLUMN "user_id_new" TO "user_id";--> statement-breakpoint
ALTER TABLE "danmaku" DROP COLUMN "video_id";--> statement-breakpoint
ALTER TABLE "danmaku" RENAME COLUMN "video_id_new" TO "video_id";--> statement-breakpoint
ALTER TABLE "feedback" DROP CONSTRAINT "feedback_pkey";--> statement-breakpoint
ALTER TABLE "feedback" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "feedback" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "feedback" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "feedback" RENAME COLUMN "user_id_new" TO "user_id";--> statement-breakpoint
ALTER TABLE "feedback" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "feedback" RENAME COLUMN "anime_id_new" TO "anime_id";--> statement-breakpoint
ALTER TABLE "histories" DROP CONSTRAINT "histories_pkey";--> statement-breakpoint
ALTER TABLE "histories" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "histories" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "histories" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "histories" RENAME COLUMN "user_id_new" TO "user_id";--> statement-breakpoint
ALTER TABLE "histories" DROP COLUMN "video_id";--> statement-breakpoint
ALTER TABLE "histories" RENAME COLUMN "video_id_new" TO "video_id";--> statement-breakpoint
ALTER TABLE "scores" DROP CONSTRAINT "scores_pkey";--> statement-breakpoint
ALTER TABLE "scores" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "scores" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "scores" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "scores" RENAME COLUMN "user_id_new" TO "user_id";--> statement-breakpoint
ALTER TABLE "scores" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "scores" RENAME COLUMN "anime_id_new" TO "anime_id";--> statement-breakpoint
ALTER TABLE "series" DROP CONSTRAINT "series_pkey";--> statement-breakpoint
ALTER TABLE "series" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "series" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "tags" DROP CONSTRAINT "tags_pkey";--> statement-breakpoint
ALTER TABLE "tags" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "tags" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "topics" DROP CONSTRAINT "topics_pkey";--> statement-breakpoint
ALTER TABLE "topics" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "topics" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_pkey";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "videos" DROP CONSTRAINT "videos_pkey";--> statement-breakpoint
ALTER TABLE "videos" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "videos" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "videos" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "videos" RENAME COLUMN "anime_id_new" TO "anime_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_pkey";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "tasks" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "anime_to_tags" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "anime_to_tags" RENAME COLUMN "anime_id_new" TO "anime_id";--> statement-breakpoint
ALTER TABLE "anime_to_tags" DROP COLUMN "tag_id";--> statement-breakpoint
ALTER TABLE "anime_to_tags" RENAME COLUMN "tag_id_new" TO "tag_id";--> statement-breakpoint
ALTER TABLE "anime_to_topics" DROP COLUMN "anime_id";--> statement-breakpoint
ALTER TABLE "anime_to_topics" RENAME COLUMN "anime_id_new" TO "anime_id";--> statement-breakpoint
ALTER TABLE "anime_to_topics" DROP COLUMN "topic_id";--> statement-breakpoint
ALTER TABLE "anime_to_topics" RENAME COLUMN "topic_id_new" TO "topic_id";--> statement-breakpoint

-- ========== 阶段三：重建主键/外键/唯一约束/索引 ==========

ALTER TABLE "anime_to_tags" ADD CONSTRAINT "anime_to_tags_anime_id_tag_id_pk" PRIMARY KEY("anime_id","tag_id");--> statement-breakpoint
ALTER TABLE "anime_to_topics" ADD CONSTRAINT "anime_to_topics_anime_id_topic_id_pk" PRIMARY KEY("anime_id","topic_id");--> statement-breakpoint
ALTER TABLE "anime" ADD CONSTRAINT "anime_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "danmaku" ADD CONSTRAINT "danmaku_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "histories" ADD CONSTRAINT "histories_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_pkey" PRIMARY KEY("id");--> statement-breakpoint

ALTER TABLE "anime_to_tags" ADD CONSTRAINT "anime_to_tags_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_to_tags" ADD CONSTRAINT "anime_to_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_to_topics" ADD CONSTRAINT "anime_to_topics_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_to_topics" ADD CONSTRAINT "anime_to_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime" ADD CONSTRAINT "anime_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "danmaku" ADD CONSTRAINT "danmaku_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "danmaku" ADD CONSTRAINT "danmaku_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "histories" ADD CONSTRAINT "histories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "histories" ADD CONSTRAINT "histories_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "anime" ADD CONSTRAINT "anime_series_season_unique" UNIQUE("series_id","season");--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_anime_unique" UNIQUE("user_id","anime_id");--> statement-breakpoint
ALTER TABLE "histories" ADD CONSTRAINT "histories_user_video_unique" UNIQUE("user_id","video_id");--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_user_anime_unique" UNIQUE("user_id","anime_id");--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_anime_episode_unique" UNIQUE("anime_id","episode");--> statement-breakpoint

CREATE INDEX "anime_series_id_idx" ON "anime" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "collections_user_id_idx" ON "collections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "collections_anime_id_idx" ON "collections" USING btree ("anime_id");--> statement-breakpoint
CREATE INDEX "danmaku_user_id_idx" ON "danmaku" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "danmaku_video_id_idx" ON "danmaku" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "feedback_user_id_idx" ON "feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "feedback_anime_id_idx" ON "feedback" USING btree ("anime_id");--> statement-breakpoint
CREATE INDEX "histories_user_id_idx" ON "histories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "histories_video_id_idx" ON "histories" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "scores_user_id_idx" ON "scores" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scores_anime_id_idx" ON "scores" USING btree ("anime_id");--> statement-breakpoint
CREATE INDEX "videos_anime_id_idx" ON "videos" USING btree ("anime_id");--> statement-breakpoint
CREATE INDEX "anime_to_tags_anime_id_idx" ON "anime_to_tags" USING btree ("anime_id");--> statement-breakpoint
CREATE INDEX "anime_to_tags_tag_id_idx" ON "anime_to_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "anime_to_topics_anime_id_idx" ON "anime_to_topics" USING btree ("anime_id");--> statement-breakpoint
CREATE INDEX "anime_to_topics_topic_id_idx" ON "anime_to_topics" USING btree ("topic_id");--> statement-breakpoint
