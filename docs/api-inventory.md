# Qnya 接口与架构梳理

> 原则：一个功能一个实现、一个接口一个入口。本文档为全部实际接口的汇总，以及按第一性原理审查出的冗余、错位与收敛建议。

## 一、架构分层

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

分层规则（现状即约定）：

- 路由层只做：参数校验、权限、编排、响应塑形。**不写 SQL**。
- repository 是 SQL 唯一归属地；一个业务查询只存在一份。
- MCP 工具 = 同一 repository 的第二个入口，禁止复制业务逻辑（已核对：update-anime→update、list-anime→findAll、create-anime→create，全部复用）。

## 二、接口清单

### 2.1 auth（5）

| 接口                       | 实现                                                                              |
| -------------------------- | --------------------------------------------------------------------------------- |
| GET `/api/auth/me`         | sessionRepository + usersRepository.findById                                      |
| PUT `/api/auth/me`         | usersRepository.update                                                            |
| POST `/api/auth/send-code` | verificationService.sendVerificationCode（code-repository + mail-service）        |
| POST `/api/auth/login`     | verificationService.verifyCode + usersRepository.findOrCreate + sessionRepository |
| POST `/api/auth/logout`    | sessionRepository                                                                 |

### 2.2 client（14，登录即可；互动要求 user+）

| 接口                                             | 实现                                                           | 备注                                  |
| ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------- |
| GET `/api/client/home`                           | homeRepository.findCollections + findAnimeTypes                | 首页聚合                              |
| ~~GET `/api/client/anime/hot`~~                  | ~~animeRepository.findHot~~                                    | 已删除（与 list?sort=1 等价，见 3.1） |
| GET `/api/client/anime/guess`                    | animeRepository.findGuess                                      | 兴趣分+CF+稳定随机                    |
| GET `/api/client/anime/list`                     | animeRepository.findClientList                                 | 六维筛选×五种排序                     |
| GET `/api/client/anime/tags`                     | tagsRepository.findClientOptions                               | 按角色隐藏成人向标签                  |
| GET `/api/client/search/suggestions`             | animeSearch.suggest + findSeasonByIds                          | 搜索联想                              |
| GET `/api/client/search`                         | animeSearch.search + findByIdsWithMeta                         | Meili 检索 PG 水合                    |
| GET `/api/client/topics`                         | topicsRepository.findPublished                                 |                                       |
| GET `/api/client/topics/:id`                     | topicsRepository.findPublishedDetail                           | 复用 findByIdsWithMeta                |
| GET `/api/client/feedback/:animeId`              | feedbackRepository                                             |                                       |
| GET `/api/client/play/:videoId`                  | playRepository.findDetail                                      | 播放页聚合                            |
| POST `/api/client/play/:videoId/views`           | playRepository.incrementViews                                  |                                       |
| GET/POST `/api/client/play/:videoId/danmakus`    | playRepository.findDanmakus / createDanmaku                    |                                       |
| POST `.../history` `.../collection` `.../rating` | playRepository.upsertHistory / toggleCollection / createRating |                                       |
| GET `/api/client/mine/collections`               | playRepository.findUserCollections                             | ⚠ 归属错位（见 3.2）                  |
| GET `/api/client/mine/histories`                 | playRepository.findUserHistories                               | ⚠ 同上                                |

### 2.3 admin（44）

| 模块        | 接口                                                     | 实现                                                            |
| ----------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| anime       | POST `/` GET `/` GET `/options` PUT `/:id` DELETE `/:id` | animeRepository.create/findAll/findAllOptions/update/deleteById |
| series      | POST `/` GET `/` DELETE `/:id` GET `/options`            | seriesRepository 同名方法                                       |
| videos      | POST `/` GET `/` PUT `/:id` DELETE `/:id`                | videosRepository 同名方法                                       |
| tags        | GET `/` GET `/options`                                   | tagsRepository.findAll/findAllOptions                           |
| topics      | POST `/` GET `/` PUT `/:id` DELETE `/:id`                | topicsRepository.create/findAll/update/deleteById               |
| collections | GET `/` DELETE `/:id`                                    | collectionsRepository.findAll/deleteById                        |
| histories   | GET `/` DELETE `/:id`                                    | historiesRepository.findAll/findById/deleteById                 |
| danmaku     | GET `/` DELETE `/:id`                                    | danmakuRepository 同名方法                                      |
| scores      | GET `/` PUT `/:id`（审核） DELETE `/:id`                 | scoresRepository                                                |
| feedbacks   | GET `/` PUT `/:id` DELETE `/:id`                         | feedbackRepository                                              |
| users       | GET `/` PUT `/:id`                                       | usersRepository.findAll/update                                  |
| dashboard   | GET `/stats`                                             | dashboardRepository.getStats（20 并行查询+30s 缓存）            |
| recommend   | GET `/status` POST `/refresh`                            | recommendRepository.getStatus/refreshAffinity                   |
| search      | POST `/reindex`                                          | animeSearch.reindexAll                                          |
| settings    | GET `/info` POST `/cache`（清缓存）                      | config + invalidateDashboardCache                               |
| files       | GET `/tree`                                              | 文件系统读取（视频目录）                                        |
| resources   | GET `/`                                                  | 资源搜索（TMDB/qbit 聚合）                                      |
| tasks       | GET `/` DELETE `/:id` POST `/ingest`                     | tasksRepository + downloader                                    |
| torrents    | GET `/` POST `/`                                         | qbit-service                                                    |
| scrape      | GET `/search` GET `/detail`                              | TMDB 代理                                                       |

### 2.4 mcp（13 tools）——零独立实现

`list_anime / get_anime / create_anime / update_anime / list_series / list_tags / list_tasks / list_torrents / add_torrent / search_resources / search_tmdb / get_tmdb_detail / get_site_stats` 全部调用既有 repository/service。唯一语义分叉：`create_anime` 系列不存在时自动创建（AI 助手语义），admin 创建时 404（表单语义）——行为不同但底层同源，合理。

### 2.5 webhook / health

| 接口                | 实现                                    |
| ------------------- | --------------------------------------- |
| POST `/api/webhook` | qBittorrent 下载完成回调 → tasks/videos |
| GET `/api/health`   | 存活探针                                |

## 三、审查结论

### 3.1 真冗余（同功能多实现，应收敛）

**R1. `hot` ≡ `list?sort=score`（一个功能两种接口）—— 已收敛**
`findHot` 与 `findClientList(sort='score')` 的 WHERE（非 draft + excludeTypes）与 ORDER BY（scoreCount→avgScore→id）完全一致，list 是 hot 的严格超集。已删除 hot 接口与 findHot，热门页改请求 `list?sort=1`。

**R2. 「按番剧批量取视频统计」写了 4 遍 —— 已收敛**
同一件事（番剧 id 列表 → 每番集数 + 首集 videoId）曾存在四份实现：

1. `homeRepository.findVideoStats`（count + firstId）—— 已删除
2. `playRepository.attachStats` —— 改为复用 batchStats
3. `playRepository.findUserCollections` 内联 videosByAnime —— 已随方法迁入 interaction-repository 并复用 batchStats
4. `animeRepository.attachMeta` 的视频分支（完整视频列表，需求不同）—— 保留

现状：`videosRepository.batchStats(animeIds)` 是唯一实现（count/firstId/playCount 单次聚合），videos 表的客户端统计查询只有一份。

**R3. `guess` 的列与条件双份表达 —— 已收敛**
现从 `clientColumns` 程序化生成 SQL 片段：`clientSelect = sql.join(Object.entries(clientColumns).map(...))`，主查询不带表别名使 drizzle 列限定符（`"anime"."xxx"`）直接合法；`excludeSql` 同样由列对象生成。列与条件各自只有一个来源，改列不再需要同步两处。

**R4. 死代码 —— 已清除**

- `usersRepository.create`：无调用者（登录走 findOrCreate，管理端只有 update）→ 已删。
- `getStatus` 内部改为复用 `getLastRefreshedAt`，重建时间单一来源。

### 3.2 架构摆放不合理（领域错位）

**A1. `play-repository` 是 502 行杂物箱 —— 已拆分**
曾堆叠 7 类职责。现拆出 `interaction-repository`（弹幕/进度/追番/评分 + mine 两个列表，"用户×内容互动"域），play-repository 只留播放详情与 views 自增。

**A2. mine 路由零逻辑（正确），业务已归位 interaction-repository。**

### 3.3 层间数据传输（评估后保留）

- **excludeTypes 链路**：rbac 中间件 → `request.excludeTypes` → 4 个 route 各一行显式透传 → repository 参数 → SQL。可改为 repository 从 request-context 隐式读取，省 4 行样板——但那会让数据访问隐式依赖 HTTP 上下文，测试与复用变差。**结论：保持显式透传**，4 行样板是分层显式性的合理代价，不抽象。
- **dashboard 聚合**：单接口 20 个并行查询 + 30s TTL 缓存 + 写路径主动失效（feedback/scores 两仓调用 `invalidateDashboardCache`）。新增写仓需记得失效是脆弱点，但 TTL 兜底使其无害，**不再加失效机制**。
- **搜索水合**：Meili 出 id → PG `findByIdsWithMeta`（批量 2 查询）→ 按 Meili 顺序重排。一次往返，无 N+1，形态正确。

### 3.4 显式复制（不是臭抽象，保留）

- 8 个 admin CRUD 仓（collections/histories/danmaku/scores/tags/series/topics/videos）形态相似但表结构与关联各异。用泛型 CRUD 工厂消灭重复会把"字段差异"藏进元编程，读代码要跳两层——每表显式写比反射式复用便宜。**判断标准：复用逻辑（同数据同查询）是冗余；复用形状（相似但不同的代码）不是。**
- `verification-service`（编排）+ `code-repository`（存储）+ `mail-service`（发送）三层：编排层有真实逻辑（失败回滚验证码、防爆破计数），不是转发壳，保留。

## 四、收敛清单（已全部执行）

| #   | 动作                                                                                                                                                           | 状态      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | 删 `/api/client/anime/hot` + `findHot`，热门页改 `list?sort=1`；响应 schema 统一为 `ClientListResponseSchema`                                                  | ✅ 已完成 |
| 2   | 视频统计收敛到 `videosRepository.batchStats`（集数/首集/播放量，单次聚合）；home/play/mine 三处重复实现删除，仅 `attachMeta` 因需完整视频列表保留              | ✅ 已完成 |
| 3   | guess 列/条件单一来源：`clientSelect` 由 `clientColumns` 派生（`sql.join` + 列对象嵌入），主查询去表别名使 drizzle 列限定符合法；`excludeSql` 同样由列对象生成 | ✅ 已完成 |
| 4   | 拆出 `interaction-repository`（弹幕/进度/追番/评分/我的两列表）；play-repository 仅保留播放详情与播放数                                                        | ✅ 已完成 |
| 5   | 删死代码 `usersRepository.create`；`getStatus` 复用 `getLastRefreshedAt`                                                                                       | ✅ 已完成 |

验证记录：hot 404、`list?sort=1` 首条与原 hot 一致、guess 分页稳定无重复且角色过滤生效（admin 456/user 366）、home videoCount/firstId、play 详情 stats 与 DB 直查一致（11/276/1）、admin recommend status 正常、临时测试账号已清理。
