# Qnya MCP 操作指南

本文档供接入 Qnya MCP 的 AI 模型使用，描述所有可用工具、标准工作流和强制约束。

---

## 工具速查（20 个）

### 概览

| 工具             | 用途                                                             |
| ---------------- | ---------------------------------------------------------------- |
| `get_site_stats` | 获取站点概览（番剧数、下载数、用户数等），建议每次会话开始时调用 |

### TMDB

| 工具              | 用途                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `search_tmdb`     | 按关键词搜索番剧或电影，返回候选列表（含 tmdbId、mediaType）                                         |
| `get_tmdb_detail` | 获取 TMDB 详情。TV 不传 season 返回季列表；传 season 返回该季完整字段及剧集列表（season 0 为特别篇） |

### 番剧管理

| 工具           | 用途                                                              |
| -------------- | ----------------------------------------------------------------- |
| `list_anime`   | 查询番剧列表，支持 keyword/status/types/years/months/tagIds 筛选  |
| `get_anime`    | 按 ID 获取单条番剧完整字段（含 description、cover、director、cv） |
| `list_series`  | 查询系列列表（一个系列含多季）                                    |
| `list_tags`    | 获取所有标签（id + name），入库前必须调用以获取 tagIds            |
| `create_anime` | 将番剧入库，系列不存在时自动创建                                  |
| `update_anime` | 修改已入库番剧的字段，只传需要修改的字段                          |

### 剧集与专题

| 工具           | 用途                                                                        |
| -------------- | --------------------------------------------------------------------------- |
| `list_videos`  | 查看番剧的剧集列表（含 id、标题、编号、播放地址），补集/修集前必查          |
| `create_video` | 为已入库番剧添加剧集（播放记录），episode 为 0.5 网格（支持 SP 小数集数）   |
| `update_video` | 修改剧集的标题/集数编号/播放地址，只传需要修改的字段                        |
| `delete_video` | 删除剧集记录，必须用户确认后携带 confirm: true                              |
| `list_topics`  | 查询专题列表（含收录番剧），建专题前查重名，编辑前获取 id 和现状            |
| `create_topic` | 创建专题推荐页并收录番剧，默认草稿（status=true 发布）                      |
| `update_topic` | 修改专题字段或整体替换收录番剧（animeIds 为全量替换，追加需先合并现有列表） |

### 下载管理

| 工具               | 用途                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| `add_torrent`      | 添加磁力链接或种子 URL 到 qBittorrent，返回 torrentHash                   |
| `list_torrents`    | 查看 qBittorrent 下载列表和进度                                           |
| `list_tasks`       | 查看下载完成后待入库的文件任务（webhook 自动生成）                        |
| `search_resources` | 从 animes.garden 按关键词搜索磁力资源，返回 magnet 可直接传给 add_torrent |

---

## 标准工作流

### 工作流一：入库新番

```
1. get_site_stats          确认站点状态，了解现有番剧数量
2. list_anime(keyword)     用番剧名查重，确认未入库
3. search_tmdb(query)      搜索候选，获取 tmdbId 和 mediaType
4. get_tmdb_detail         TV: 先不传 season → 查看季列表 → 再按需传 season 获取详情
                           Movie: 直接获取详情
5. list_tags               获取所有标签，选择与题材匹配的 tagIds
6. create_anime            填入第 4、5 步获得的字段完成入库
7. create_video            （可选）逐集添加播放记录：正片整数，SP/总集篇 0.5 网格小数
8. search_resources(name)  （可选）搜索磁力资源，将结果完整展示给用户
                           → 等待用户从列表中选定一条
9. add_torrent(magnet)     （可选）用用户选定的 magnet 添加下载，记录 torrentHash
```

### 工作流二：监控下载进度

```
1. list_torrents           查看所有下载任务的进度和状态
2. list_tasks(status:      查看已完成下载、等待入库的文件
   ['pending'])
→ 提示用户手动在管理后台执行文件入库操作（AI 不操作文件系统）
```

### 工作流三：修正入库信息

```
1. list_anime(keyword)     找到番剧，获取 id
2. get_anime(id)           查看当前完整字段，确认需要修改的内容
3. update_anime(id, ...)   只传需要修改的字段
```

### 工作流四：站点巡检

```
1. get_site_stats          查看番剧状态分布（draft/upcoming/airing/completed）
2. list_anime(status:      检查长期停留在 draft 的番剧
   ['draft'])
3. list_torrents           检查是否有卡住的下载
4. list_tasks(status:      检查是否有积压的待入库任务
   ['pending'])
```

### 工作流五：为番剧补充/修正剧集

```
1. list_anime(keyword)     找到番剧，获取 id
2. list_videos(id)         查看已有剧集，确定缺哪些
3. create_video            逐集添加播放记录：正片整数，SP/总集篇 0.5 网格小数（6.5、12.5）
4. update_video            （修正）填错标题/编号/地址时使用，id 来自 list_videos
5. delete_video            （下架）必须先向用户确认，再携带 confirm: true 调用
→ 注意：文件实体入库（tasks 入库）仍需用户在管理后台手动完成，
  create_video 只负责创建播放记录（url 从用户提供的地址填入）
```

### 工作流六：创建/维护专题推荐

```
1. list_topics(...)        查看现有专题，查重名（也可按 keyword/status 筛选）
2. list_anime(...)         按主题筛选番剧，收集 id 列表（如某季度全部新番）
3. create_topic            填入名称/简介/封面，animeIds 传入收集的 id，默认草稿
4. update_topic            （维护）追加番剧时先从 list_topics 取现有列表合并后整体替换；
                           预览确认后传 status: true 发布
```

### 工作流七：对照 TMDB 剧集列表补集

```
1. get_tmdb_detail(season) 拉取该季 episodes 列表（编号/标题/播出日期/类型）
2. get_tmdb_detail(season: 0)（可选）拉取特别篇列表，按播出日期插到正片之间映射为 6.5、12.5
3. list_videos(id)         对账：找出 TMDB 有而站内缺的集数
4. create_video            逐集补齐
```

---

## 强制约束

### 入库前必须

- **查重**：`create_anime` 前必须调用 `list_anime` 确认番剧不存在；`create_topic` / `update_topic` 改名前用 `list_topics` 查重名
- **获取标签**：`create_anime` 前必须调用 `list_tags`，`tagIds` 只能来自此工具的返回值，不能凭空填写
- **剧集编号规范**：`create_video` / `update_video` 的 episode 为非负且 0.5 的整数倍；正片整数，SP/总集篇小数（6.5、12.5），0 为先导集；同番剧重复集数会被拦截

### TV 番剧详情获取

- 必须分两步：先调用 `get_tmdb_detail`（不传 season）查看季列表，再传 season 获取该季详情
- 不要直接猜测 season 编号跳过第一步

### ID 来源规则

| 字段                         | 必须来自                           |
| ---------------------------- | ---------------------------------- |
| `update_anime` 的 `id`       | `list_anime` 返回的 `id` 字段      |
| `get_anime` 的 `id`          | `list_anime` 返回的 `id` 字段      |
| `create_anime` 的 `tagIds`   | `list_tags` 返回的 `id` 字段       |
| `create_video` 的 `animeId`  | `list_anime` 返回的 `id` 字段      |
| `update_video` 的 `id`       | `list_videos` 返回的 `id` 字段     |
| `delete_video` 的 `id`       | `list_videos` 返回的 `id` 字段     |
| `create_topic` 的 `animeIds` | `list_anime` 返回的 `id` 字段      |
| `update_topic` 的 `id`       | `list_topics` 返回的 `id` 字段     |
| `add_torrent` 后的 hash      | `add_torrent` 返回的 `torrentHash` |

### 不允许的操作

- 不操作文件系统（文件入库由用户在管理后台手动完成）
- 不删除番剧或系列（无对应工具，需用户在管理后台操作）
- 删除剧集（`delete_video`）属于危险操作：必须先向用户确认，征得同意后携带 `confirm: true` 调用
- `update_topic` 的 `animeIds` 是整体替换：追加前必须先从 `list_topics` 取现状合并，禁止凭空猜测导致误删收录
- 不修改用户数据、弹幕、评分等内容（超出 MCP 授权范围）
- **不自行选择资源**：`search_resources` 结果必须完整展示给用户，等用户确认后才能调用 `add_torrent`

---

## 字段枚举参考

**status**：`draft` | `upcoming` | `airing` | `completed`

**type**：`movie` | `japanese` | `american` | `chinese` | `adult`

**month**（季度）：`january`（1月番）| `april`（4月番）| `july`（7月番）| `october`（10月番）

**episode**（剧集编号）：非负、0.5 的整数倍；正片整数，SP/总集篇小数（6.5、12.5），0 为先导集

**episode_type**（TMDB 剧集类型）：`standard`（正片）| `special`（特别篇）| `recap`（回顾）等，用于判断编号映射

**下载状态筛选**：`downloading` | `stalledDL` | `pausedDL` | `uploading` | `error`

---

## list_anime 返回字段说明

`list_anime` 返回精简字段（不含 description、cover、banner、cv 等长文本）：

```
id, seriesId, name, season, seasonName, status, type, year, month, avgScore
```

需要完整字段时，用 `get_anime(id)` 补充查询。`get_anime` 不含 tags，如需 tags 另调 `list_tags`。
