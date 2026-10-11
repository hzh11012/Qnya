-- 番剧亲和表（协同过滤共现矩阵）：
-- score = 同时与两番剧有过互动（观看/追番/评分）的用户数，
-- 由 recommend 定时任务全量重建，供「猜你喜欢」做 CF 加权
CREATE TABLE "anime_affinity" (
	"anime_id" uuid NOT NULL,
	"related_anime_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anime_affinity_anime_id_related_anime_id_pk" PRIMARY KEY("anime_id","related_anime_id")
);--> statement-breakpoint
ALTER TABLE "anime_affinity" ADD CONSTRAINT "anime_affinity_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_affinity" ADD CONSTRAINT "anime_affinity_related_anime_id_anime_id_fk" FOREIGN KEY ("related_anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anime_affinity_related_idx" ON "anime_affinity" USING btree ("related_anime_id");
