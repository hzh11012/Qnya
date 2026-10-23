# AGENTS.md

给 AI 编码代理（Claude Code、pi、Cursor 等）的项目上下文。改动前请先读完本文件。

## 项目概览

Qnya 后端：动漫流媒体平台（Fastify + TypeScript ESM + PostgreSQL/Drizzle + Redis + Meilisearch）。

- **技术栈**：Fastify 5（Zod TypeProvider）、Drizzle ORM（node-postgres）、ioredis、Meilisearch、@fastify 全家桶（autoload/env/cookie/csrf/cors/helmet/rate-limit/swagger/sensible）
- **运行环境**：Node ≥ 24，pnpm ≥ 10，ESM（`"type": "module"`，导入要带 `.js` 后缀）
- **部署**：Docker + nginx（`nginx.conf` 中 `/media/` 静态文件走 `auth_request` 鉴权）

## 常用命令

```bash
pnpm dev              # 开发（tsx watch，NODE_ENV 非 production）
pnpm lint             # eslint（提交前必须通过）
pnpm format           # prettier
pnpm openapi:export   # 导出 openapi.json（需先启动 Meilisearch，见下）
pnpm db:generate      # drizzle 生成迁移
pnpm db:migrate       # 执行迁移
pnpm db:studio        # drizzle studio
```

- **类型检查**：`npx tsc -b`（日志里的 INFO/WARN 行可忽略）
- **Meilisearch 必须先启动**，否则 `pnpm openapi:export` / `pnpm dev` 会在 `onReady` 健康检查处超时（Fastify 插件 10s 超时报 `FST_ERR_HOOK_TIMEOUT`）
- **提交规范**：Conventional Commits（commitlint 强制），如 `feat: xxx` / `fix: xxx`

## 架构（三层）

```
src/
├── config/app.ts        # buildApp：autoload 顺序 external → app → routes
├── plugins/external/    # 基础设施插件（env/db/redis/csrf/cors/rate-limit/swagger…）
├── plugins/app/         # 领域插件：*-repository.ts（数据访问）+ 中间件（auth/rbac）
├── routes/api/          # 路由：admin/（RBAC admin）、client/（用户端）、auth/、
│                        #   media/（nginx auth_request）、mcp/（Bearer）、webhook/（qBit）
├── schemas/             # 每个领域的 zod schema（请求/响应共用）
├── db/                  # Drizzle 表定义（按领域分目录）+ relations + migrate
└── utils/
```

- 插件通过 `fastify-plugin`（fp）+ `dependencies` 声明加载顺序，装饰器：`fastify.db` / `.redis` / `.config` / `.authenticate` / `.rbac` / `.sessionRepository` / 各领域 repository
- repository 工厂模式：`createXxxRepository(fastify)` 闭包持有 `db`，经 fp 挂到实例上
- 路由文件默认导出 `async (fastify) => {}`，由 autoload 注册；目录即 URL 前缀

## 硬性约定（改代码前必读）

1. **鉴权**：所有非公开路由必须显式 `preHandler`。项目不单独用 `authenticate`，而是 `rbac.requireRoleAtLeast('user'|'premium'|'admin')`（内含登录校验）；游客可访问的接口用 `authenticate`/`optionalAuthenticate` + `rbac.filterAdultTypes()`
2. **userId 一律取自 `request.sessionData!.userId`**，绝不接受客户端传入的用户标识（防 IDOR）
3. **输入/输出**：每个路由必须声明 zod schema（`schema.body/querystring/response`），响应用 `SuccessResponseSchema(...)` 包装，返回用 `reply.success(msg, data)` / `httpErrors.xxx()`；数值边界要给 min/max（参考 `schemas/play.ts`）
4. **SQL**：一律 drizzle 参数化；ILIKE 关键字搜索必须 `escapeLike()` 转义 `%`/`_`；原生 SQL 用 `sql` 模板（值自动绑定，不要拼接）
5. **会话**：token 只存 SHA-256 哈希（见 `session-repository.ts`）；改用户角色/状态后必须同步刷会话（`refreshUserSessionsRole/Status`），否则在线用户不受影响
6. **多表写必须 `db.transaction`**；独立的查询用 `Promise.all` 并行
7. **敏感比较用 `timingSafeEqual`**（参考 `routes/api/webhook`、`routes/api/mcp` 里的 `safeEqual`）
8. **安全相关豁免必须注释理由**（如 media 路由豁免限流、CSRF 豁免清单）

## 与前端的契约

- `pnpm openapi:export` 重新生成 `openapi.json` → 前端仓库执行 `pnpm gen:api` 同步类型
- 改任何响应 schema 后必须走一遍这个流程，前端类型才不会漂移
- 统一响应包装：`{ code, message, data }`

## 已知取舍（不要"顺手修"）

- **限流是内存存储**：单实例部署够用；多实例才需要换 Redis store
- **webhook token 在 query string**：qBittorrent 事件回调机制限制，无法放 header
- **MCP 会话在进程内存**：重启丢失可接受（客户端自动重连）
- `histories` 表没有 `user_id` 单列索引：`(user_id, anime_id)` 复合唯一索引的最左前缀已覆盖

## 测试

目前没有自动化测试（已知欠债）。改动安全关键逻辑（auth/csrf/rbac/路径校验）后，至少手工回归对应接口。
