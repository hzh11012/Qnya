ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user';
-- 存量自动注册用户统一为普通用户角色
UPDATE "users" SET "role" = 'user' WHERE "role" = 'guest';
