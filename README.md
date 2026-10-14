# Qnya

Qnya 番剧平台的核心 API 服务，基于 Fastify 5 构建。为客户端（Qnya-Frontend）与管理后台（Qnya-Backend）提供全部接口，并通过 MCP 端点向 AI 客户端暴露平台数据工具。

## 架构分层

```
routes/api/
  auth/      认证（登录/登出/验证码/me）
  client/    前台消费侧（浏览/播放/互动/我的）
  admin/     管理后台（内容 CRUD/运营/系统）
  mcp/       AI 工具（复用同一 repository 层，无独立实现）
  webhook/   外部回调（qBittorrent 完成事件）
  health/    健康检查
      │  zod schema 校验（一进一出）+ preHandler: authenticate → rbac
      ▼
plugins/app/*-repository.ts   领域数据访问（一表/一域一仓，SQL 唯一归属地）
plugins/app/anime-search.ts   Meilisearch 检索（PG 为唯一事实来源，索引自愈）
plugins/app/rbac/             角色中间件（requireRoleAtLeast / filterAdultTypes）
      │  drizzle
      ▼
PostgreSQL ｜ Redis(session/缓存/验证码) ｜ qBittorrent ｜ SMTP ｜ TMDB
```

分层规则：

- 路由层只做参数校验、权限、编排、响应塑形，**不写 SQL**。
- repository 是 SQL 唯一归属地，一个业务查询只存在一份。
- MCP 工具是同一 repository 的第二个入口，禁止复制业务逻辑。

## 角色权限

| 角色      | 能力                                   |
| --------- | -------------------------------------- |
| `guest`   | 登录后浏览非成人内容、修改个人资料     |
| `user`    | 播放、弹幕、追番、评分、观看历史等互动 |
| `premium` | user 全部能力 + 成人内容可见           |
| `admin`   | 全部能力 + 管理后台                    |

- 除少数可选会话接口外，接口默认需登录（未登录 401）；权限不足返回 403。
- 成人内容（里番类型/工口等标签）按角色过滤，接口层通过 `rbac.filterAdultTypes()` 统一注入 `excludeTypes`。

## 接口概览

| 分组      | 说明                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `auth`    | 验证码发送、登录、注册、登出、当前用户                                                                                       |
| `client`  | 首页聚合、番剧筛选列表/标签/猜你喜欢、搜索、播放详情、弹幕/进度/追番/评分、我的追番/历史、专题、反馈                         |
| `admin`   | 概览统计、番剧/系列/视频/标签/弹幕 CRUD、资源检索与种子任务、追番/评分/历史/反馈管理、专题运营、推荐系统、用户管理、系统设置 |
| `mcp`     | Model Context Protocol 端点（Streamable HTTP，Bearer Token 鉴权）                                                            |
| `webhook` | qBittorrent 下载完成回调（鉴权密钥校验）                                                                                     |
| `health`  | 健康检查                                                                                                                     |

OpenAPI 文档仅在开发环境暴露（swagger-ui），可通过 `pnpm openapi:export` 导出 `openapi.json` 供前端生成类型。

## 技术栈

| 类别   | 技术                                                       |
| ------ | ---------------------------------------------------------- |
| 框架   | Fastify 5 + TypeScript（tsx 直跑，无构建步骤）             |
| ORM    | Drizzle ORM + drizzle-kit（迁移/推送/studio）              |
| 数据库 | PostgreSQL 17                                              |
| 缓存   | Redis 7（session、缓存、验证码、任务队列）                 |
| 搜索   | Meilisearch（繁简归一化，PG 为唯一事实来源）               |
| 校验   | Zod 4（schema 一进一出，路由级 querystring/body/response） |
| 安全   | helmet、CORS 白名单、全局限流、CSRF、签名 session cookie   |
| 邮件   | Nodemailer（SMTP 验证码，防轰炸限流）                      |
| 下载   | qBittorrent Web API + 完成事件 webhook                     |
| 元数据 | TMDB API（番剧搜索填充）                                   |
| 文档   | @fastify/swagger（dev-only）                               |
| 规范   | ESLint + Prettier + husky + Conventional Commits           |

## 项目结构

```
src/
├── bootstrap/        # 启动编排（插件注册、种子）
├── config/           # 常量配置
├── db/               # Drizzle 表定义（按域分目录）+ 迁移在 drizzle/
├── plugins/
│   ├── app/          # 领域层：*-repository、rbac、搜索、下载器、推荐、任务
│   └── external/     # 基础设施：db/redis/meilisearch/env/security 系列
├── routes/api/       # 路由（auth/client/admin/mcp/webhook/health）
├── schemas/          # zod schema（路由校验的唯一来源）
└── utils/            # 分页、繁简转换、like 转义等工具
```

## 快速开始

依赖服务可用 docker-compose 一键启动：

```bash
docker compose up -d   # PostgreSQL 17 + Redis 7 + Meilisearch + qBittorrent
```

```bash
# 1. 配置 hosts（配合 session cookie 的 domain，前端同需配置）
echo "127.0.0.1 localhost.qnya.cn" | sudo tee -a /etc/hosts

# 2. 安装依赖（Node >= 24，pnpm >= 10）
pnpm install

# 3. 配置环境变量
cp .env.example .env   # 按注释填写必填项

# 4. 同步数据库结构
pnpm db:push           # 或 pnpm db:migrate 应用迁移

# 5. 启动开发服务器（http://localhost.qnya.cn:3000）
pnpm dev
```

启动时自动执行种子逻辑：若尚无管理员，使用 `ADMIN_EMAIL` 创建默认管理员账户。

## 可用脚本

| 命令                  | 说明                                    |
| --------------------- | --------------------------------------- |
| `pnpm dev`            | 开发服务器（tsx watch，:3000）          |
| `pnpm start`          | 生产运行                                |
| `pnpm db:generate`    | 生成迁移                                |
| `pnpm db:migrate`     | 应用迁移                                |
| `pnpm db:push`        | 直接推送表结构                          |
| `pnpm db:studio`      | Drizzle Studio                          |
| `pnpm openapi:export` | 导出 openapi.json（前端类型生成依赖它） |
| `pnpm lint`           | 代码检查                                |

## Docker 部署

`docker-compose.yml` 提供完整的一套栈：PostgreSQL 17、Redis 7、Meilisearch、qBittorrent 与 app 本体（构建时自动拉取 Qnya-Frontend 产物一并打包，Nginx 托管静态资源并反代 API）。

配置与本地开发共用一份 `.env`（复制 `.env.example` 后填写必填项）；容器内的连接地址由 compose 自动注入，无需修改：

```bash
cp .env.example .env    # 填写必填项
# 局域网 HTTP 访问请将 NODE_ENV 改为 development（否则 cookie 带 Secure 标记无法登录）
docker compose up -d --build
```

访问：前台 `http://<IP>:${HTTP_PORT:-5000}`，管理后台 `http://<IP>:${HTTP_ADMIN_PORT:-5001}`，qBit WebUI `:8080`。数据库迁移在容器启动时自动执行。

### 部署后配置（必做）

否则下载完成后**不会自动创建入库任务**：

1. **qBit WebUI**（`http://<IP>:8080`）：设置登录账号密码，与 `.env` 中的 `QBIT_USERNAME` / `QBIT_PASSWORD` 保持一致；下载路径设为 `/downloads`

2. **Webhook 回调**：qBit WebUI → 设置 → 下载 → 「种子完成后运行外部程序」，填入：

   ```bash
   curl -X POST "http://app:3000/api/webhook/qbit?hash=%I&tag=%G&token=<QBIT_WEBHOOK_SECRET>"
   ```

   `<QBIT_WEBHOOK_SECRET>` 替换为 `.env` 中的实际值。应用只处理打了 `qnya` 标签的种子，其他标签的种子完成后会被忽略；任务创建后需在管理后台任务页手动「入库」

3. **管理员账号**：首次启动时使用 `.env` 中的 `ADMIN_EMAIL` 自动创建管理员，用该邮箱登录管理后台

## 相关仓库

- [Qnya-Frontend](https://github.com/hzh11012/Qnya-Frontend) — 客户端（浏览/播放）
- [Qnya-Backend](https://github.com/hzh11012/Qnya-Backend) — 管理后台（含 MCP 接入指南）
