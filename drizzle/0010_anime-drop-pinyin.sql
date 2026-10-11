-- 拼音检索已由 Meilisearch 承担（索引时由 name 动态派生拼音），
-- 管理后台列表过滤仅保留名称 ILIKE，两列及其 trgm 索引不再需要
DROP INDEX IF EXISTS "anime_name_pinyin_trgm_idx";
DROP INDEX IF EXISTS "anime_name_initials_trgm_idx";
ALTER TABLE "anime" DROP COLUMN IF EXISTS "name_pinyin";
ALTER TABLE "anime" DROP COLUMN IF EXISTS "name_initials";
