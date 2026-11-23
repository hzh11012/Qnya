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
├── index.ts             # 进程入口：DNS 顺序、信号处理、listen
├── bootstrap/           # 启动前置（Windows 控制台 UTF-8），只被 index.ts 引用
├── config/app.ts        # buildApp：autoload 顺序 external → app → routes
├── plugins/external/    # 基础设施插件（env/db/redis/csrf/cors/rate-limit/swagger…）
├── plugins/app/         # 领域插件：*-repository.ts（数据访问）+ 中间件（auth/rbac）+ 领域服务
│                        #   内部实现模块放 <domain>/internal/（非插件，autoload 跳过）
├── routes/api/          # 路由：admin/（RBAC admin）、client/（用户端）、auth/、
│                        #   app/（客户端 OTA）、media/（nginx auth_request）、mcp/（Bearer）、webhook/（qBit）
├── schemas/             # 每个领域的 zod schema（请求/响应共用），平铺一个领域一个文件
├── db/                  # Drizzle 表定义（按领域分目录：tables.ts + enums.ts + index.ts）
└── utils/               # 无状态纯函数 + 跨层共享的领域基元（如 RoomError）
```

新增一个领域时，四层各放一个同名产物：`db/<domain>/`（表+枚举+index）、
`plugins/app/<domain>/<domain>-repository.ts`（fp 插件，装饰 `fastify.<domain>Repository`）、
`schemas/<domain>.ts`（zod）、`routes/api/{admin,client}/<domain>/index.ts`（目录名即 URL 前缀）。

- 插件通过 `fastify-plugin`（fp）+ `dependencies` 声明加载顺序，装饰器：`fastify.db` / `.redis` / `.config` / `.authenticate` / `.rbac` / `.sessionRepository` / 各领域 repository
- repository 工厂模式：`createXxxRepository(fastify)` 闭包持有 `db`，经 fp 挂到实例上
- 路由文件默认导出 `async (fastify) => {}`，由 autoload 注册；目录即 URL 前缀
- `plugins/app/` 下**每个 .ts 文件都必须是 fp 插件**（导出的能力会挂到实例上）。领域内的纯实现模块
  （如「放映室」拆出的 core/lifecycle/query/playback/chat）放 `<domain>/internal/`：autoload 按目录名
  整体忽略，既不注册也不会在 debug 日志里刷 `skipping autoloading of file`
- `routes/api/mcp/` 是例外：`index.ts` 存在时 autoload 只认 index，同目录的 `server.ts` / `skills.md`
  是它自己的实现与运行时资源，不算"放错位置"
- 根目录的 `nginx.conf` / `supervisord.conf` / `docker-entrypoint.sh` 是镜像内文件，Dockerfile 直接
  `COPY`：挪进子目录必须同步改 `COPY` 路径与 entrypoint，别为了"整洁"单独搬
- 命名差异是有意的，别统一：表名复数（`watch-rooms`）、URL 单数（`/watch-room`）、
  admin 已上线的路径（`/admin/feedbacks`）一律不动——它们都是对外契约

## 硬性约定（改代码前必读）

1. **鉴权**：除 `auth` 的 send-code/login、`webhook`、`mcp`、`health` 外，所有路由必须显式声明
   `preHandler: [authenticate, rbac.requireRoleAtLeast('user'|'premium'|'admin')]`。
   两者职责不重叠：`authenticate` 解析会话（未登录 401），`rbac` 只判角色等级（不足 403）；
   不要跳过 `authenticate` 直接用 `rbac`（`sessionData` 为空会 401）。
   需按角色过滤成人内容的接口再追加 `rbac.filterAdultTypes()`（要求已登录，写入 `request.excludeTypes`）
2. **userId 一律取自 `request.sessionData!.userId`**，绝不接受客户端传入的用户标识（防 IDOR）
3. **输入/输出**：每个路由必须声明 zod schema（`schema.body/querystring/response`），响应用 `SuccessResponseSchema(...)` 包装，返回用 `reply.success(msg, data)` / `httpErrors.xxx()`；数值边界要给 min/max（参考 `schemas/play.ts`）
4. **SQL**：一律 drizzle 参数化；ILIKE 关键字搜索必须 `escapeLike()` 转义 `%`/`_`（不要内联重写）；原生 SQL 用 `sql` 模板（值自动绑定，不要拼接）；手写计数写 `count(*)::int`，否则 pg 返回字符串与 `sql<number>` 的类型不符
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
- **放映室断线宽限期是进程内定时器**（30s，`watch-room-socket.ts`）：重启即失效；多实例需换 Redis 延迟队列，否则宽限期只在接住该连接的实例上生效
- **私人房间密码通行证存 Redis（24h）**：`watch-room:password-grant:<roomId>:<userId>`，验证过一次密码后退出/断线回来不必重输。**值存的是密码哈希前 32 位（指纹）而不是固定 '1'**：房主重设密码后哈希变化，旧通行证自动失效，省掉按前缀扫 key 清理。房间解散后的残留 key 靠 TTL 过期（roomId 不复用，不会被误用）。注意 `room:join` 对「没带密码」返回 `ROOM_PRIVATE`、对「密码错」返回 `ROOM_PASSWORD_INVALID`，两种错误码前端都要落到密码表单
- **公开状态可由房主在房间内切换**：`room:update` 带 `visibility`（`password` 仅随 `private` 一起传）。转私人必须设密码（房间原有密码可沿用，前端在新密码缺失时会弹表单）；**转公开会把 `password_hash` 置空**，再转回私人要重新设。切换后广播的 `room:updated` 带上 `visibility`，成员端实时更新
- **`room:update` 的 ACK 不回房间整行**：只返回 `{ roomId, name, announcement, visibility }`，密码哈希不应该出现在网络载荷里
- **房间人数上限固定 5 人，不可配置**：`WATCH_ROOM_MAX_MEMBERS`（`db/watch-rooms/tables.ts`）同时是建表默认值与建房写入值；`WatchRoomCreateSchema` 与 `WatchRoomUpdateSchema` 都不接受 `maxMembers`，客户端想传也会被 zod 丢掉。改人数只能改常量 + 生成迁移，没有 UI、没有接口。历史房间保留各自旧上限（字段仍在，判定仍按 `room.maxMembers`），迁移只改列默认值
- **被移出的成员进 `watch_room_bans`，该房间永久拒绝其加入**：`member:kick` 在同一事务里写黑名单再删成员，`room:join` 对黑名单用户返回 `ROOM_BANNED`（事务前预检 + 事务内复核，兼顾「不用走密码表单」与并发被踢的竞态）。黑名单随房间级联删除（房间解散后自然失效），只作用于该房间，不影响用户进其它房间。管理端可查看并解除：`GET /admin/watch-room/:roomId/bans`、`DELETE .../bans/:userId`（幂等，事务提交后写 `ban.lift` 审计）
- **管理端的成员 / 黑名单 / 消息记录都是只读**：`GET /admin/watch-room/:roomId/{members,bans,messages}`。成员与黑名单是当前快照（解散即级联删除，没有历史）；消息支持 `type=chat|system` 筛选，同样随房间删除。不要给这些接口加成员校验——它们只要求 `requireAnyRole('admin')`
- **越权一律 403，别退回 404**：`requireMembership` 只有房间真的不存在才抛 `ROOM_NOT_FOUND`（404），「房间在、人不是成员」抛 `ROOM_PERMISSION_DENIED`（403）；私人房间对非成员看详情返回 `ROOM_PRIVATE`（403，与 `room:join` 的错误码一致）。以前统一伪装成 404 会让前端把「没权限」当成「房间已解散」。代价是私人房间的存在性不再隐藏——房间 ID 是 UUID，且 socket 侧的 `room:join` 本来就会回 `ROOM_PRIVATE`，藏不住
- **踢人 / 解散 / 管理端删房有审计日志**：`core.auditLog()` 经 `flush` 在事务提交后写 `fastify.log.info({ audit:'watch-room', action, ... })`（`member.kick` / `room.dissolve`，带 operator/target/roomName/reason）。房间内的系统通知会随房间级联删除（解散后一条不剩），日志留在服务端可回溯。**不要在事务里直接写**：回滚的事务会留下假记录
- **房间不跨进程存活**：`onReady` 时 `resetStaleRooms()` 清空 `watch_rooms`（级联成员/消息）。房间靠进程内 Socket 连接活着，重启后库里的房间必是死的，不清就会继续出现在大厅和「回到房间」入口。多实例部署需要改成按实例标记清理
- **大厅列表只有分页**：`WatchRoomListQuerySchema` 只接 `page/pageSize`，固定 `createdAt desc`。之前加过 `keyword`（房间名/番剧名/房主昵称）与 `sort=latest|popular`，因房间量级没必要、页面已撤掉而回滚；要加回来记得 count 查询必须补与列表相同的 join（users / videos / anime），否则关键词落在别人表上会 missing FROM-clause
- **`playback:change-video` 的 `autoplay`**：自动连播时传 `true`，服务端把 `isPlaying: true, position: 0` 一次写进房间状态并广播（客户端各自等媒体就绪后起播）；不传则是「切完暂停」（服务端仍支持，业务上前端已统一传 `true`）。不要把「先置暂停、等客户端补 play」写回来——那条两段式路径在 `canplay` 时机不准时会让全场停在 0:00
- **webhook token 在 query string**：qBittorrent 事件回调机制限制，无法放 header
- **MCP 会话在进程内存**：重启丢失可接受（客户端自动重连）
- `histories` 表没有 `user_id` 单列索引：`(user_id, anime_id)` 复合唯一索引的最左前缀已覆盖

## 测试

目前没有自动化测试（已知欠债）。改动安全关键逻辑（auth/csrf/rbac/路径校验）后，至少手工回归对应接口。
