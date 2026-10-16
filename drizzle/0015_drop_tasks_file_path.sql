-- 存量任务回填：filename 从绝对路径改为下载目录内的相对路径
-- 兼容旧前缀（/downloads/、/data/downloads/ 等），提取最后一个 /downloads/ 之后的部分
UPDATE "tasks" SET "filename" = regexp_replace("file_path", '^.*?/downloads/', '')
WHERE "file_path" LIKE '%/downloads/%';

ALTER TABLE "tasks" DROP COLUMN "file_path";
