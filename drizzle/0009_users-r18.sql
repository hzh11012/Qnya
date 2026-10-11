-- 用户 r18 内容访问权限：adult（里番）类型仅对开启该权限的用户返回
ALTER TABLE "users" ADD COLUMN "r18" boolean NOT NULL DEFAULT false;--> statement-breakpoint
-- 管理员默认拥有 r18 权限
UPDATE "users" SET "r18" = true WHERE "role" = 'admin';
