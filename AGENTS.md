# AGENTS.md — 智能体开发指南

> 本文件供 AI 编码智能体（及新接手的工程师）快速上手本项目。改动代码前必读 §2 架构不变量，违反任何一条都会造成数据错误。

## 1. 项目速览

自托管网站流量统计系统（对标简化版 Umami/Plausible）。**Next.js 14 (App Router) + Redis 热存 + SQLite 归档**，Docker 双容器单机部署（目标 4 核 8GiB）。

- 采集：目标网站嵌 `public/m.js` → `POST /api/collect` → Redis pipeline
- 大盘：首页 `/`（跨站点总览+域名排名）→ 详情 `/site/{key}`（单站分析）
- 归档：每日 cron 把 Redis 事件落 SQLite（幂等）

更多背景：`docs/analysis/`（需求/架构/容量）与 `docs/plans/`（执行计划/验证记录），改动设计前先读对应编号文档。

## 2. 架构不变量（违反即数据事故）

1. **热路径禁写 SQLite**：`/api/collect` → `lib/hot.ts` 只写 Redis。SQLite 仅允许：站点缓存未命中时的一次读、归档任务写入。
2. **每个日期单一数据源**：`date >= windowStart`（today − RETENTION_DAYS + 1）一律读 Redis，更早一律读 `daily_stats`。任何查询不得跨源重复计数（参考 `lib/stats.ts` 的 `windowStart()` 用法）。
3. **归档必须幂等**：聚合表（daily_stats/page_daily/referrer_daily）只能 `INSERT OR REPLACE ... SELECT COUNT(...)` **由 events 重算**，禁止增量累加。今日 events 键永不归档（`date < today` 才处理，见 `lib/flush.ts`）。
4. **Redis 键统一走 `K` / `K_U` 构造器**（`lib/redis.ts`）：新增键类型必须加进对应构造器并设置 `WINDOW_TTL`，flush 的 SCAN 模式与站点删除清理都依赖这套命名。**万能统计（`tw:u:*`）与 keyed 站点（`tw:*`）严格隔离**：keyed 用 `site_key`，万能用域名且 `u_sites` 自动注册；两边大盘/归档互不混算（flush 分别处理 `tw:events:*` 与 `tw:u:events:*`）。
5. **统计口径**：PV=事件数；UV=按 `visitor_id` 日去重；IP=按 `ip_hash` 日去重（SHA-256+盐，库中无明文）。来源名归一化：Redis 侧 `direct`、SQLite 侧 `''`，展示与聚合前必须过 `normRef()`。万能统计的 3 秒停留判定在客户端 `public/u.js`（定时器 + pagehide 兜底），服务端不做时长校验。
6. **默认大盘（`/`、`/site/{key}`）与万能大盘（`/universal`）互不影响**：给 keyed 站点加功能不要动 `lib/universal.ts`，反之亦然。

## 3. 常用命令

```bash
npm run dev          # 开发（需本地 Redis: redis-server --daemonize yes）
npm run build        # 生产构建（含类型/Lint 检查，CI 语义）
npm start            # 生产运行（CRON_SECRET=xxx npm start 可选注入）
npm run seed         # 演示数据：3 域名×30 天（窗口内→Redis，更早→SQLite，可重复执行）
npm run monitor      # 健康监控单次检查（WEBHOOK_URL 可选）
node scripts/verify.mjs   # 端到端冒烟：健康/登录/采集去重/总览一致性（对运行中服务执行）
```

本地 Redis 测试用 AOF：`redis-server --daemonize yes --save '' --appendonly yes --dir /tmp/tw-redis`

## 4. 代码地图

| 路径 | 职责 | 关键函数 |
|---|---|---|
| `lib/redis.ts` | ioredis 单例、`K`（keyed）/`K_U`（万能）键构造、`RETENTION_DAYS`/`WINDOW_TTL` | — |
| `lib/hot.ts` | 采集热路径（限流/站点缓存/pipeline 写入） | `recordHot` `rateLimited` |
| `lib/universal.ts` | 万能统计：域名自动注册、热路径、独立大盘查询（`tw:u:*` 命名空间） | `recordUniversal` `universalBoard` |
| `lib/flush.ts` | 归档：SCAN→入库→DEL→重算聚合；防并发锁 | `flushOnce` `recomputeDay` |
| `lib/scheduler.ts` | cron 注册（探活按需拉起，幂等单例） | `ensureScheduler` |
| `lib/stats.ts` | 混合查询 + 跨站总览 | `summary` `dailySeries` `details` `overview` `feed` |
| `lib/db.ts` | SQLite schema、`dateStr()`（APP_TZ 日期） | — |
| `lib/track.ts` | UA/Referer 解析、IP 提取与哈希 | `normalizeReferrer` `hashIP` |
| `lib/auth.ts` | 密码登录、HMAC cookie session | `isAuthenticated` |
| `app/api/*` | collect / overview / stats / feed / sites / auth / health / cron/flush | 各 route.ts |
| `components/Overview.tsx` | 首页大屏（合计+域名排名+迷你趋势 SVG） | — |
| `components/Dashboard.tsx` | 单站详情（`fixedKey` 子页模式）+ 实时动态卡 | — |
| `scripts/seed.mjs` | 双路径演示数据（与线上键/格式完全同构） | — |
| `scripts/health-monitor.mjs` | 服务器监控 + webhook 通知 | — |

## 5. 关键设计决策与坑（改前必读）

1. **归档 cron 不用 `instrumentation.ts`**：Next 14 会把它编译进 edge bundle，ioredis/better-sqlite3 无法豁免（构建失败）。改为 `/api/health` 探活时 `ensureScheduler()` 拉起（Docker healthcheck 60s 保证触发）。
2. **`serverComponentsExternalPackages`** 必须含 `ioredis`/`better-sqlite3`/`node-cron`（`next.config.mjs`），否则 webpack 打包 Node 内建模块报错。
3. **tsconfig `target: ES2017`**：Map 迭代器展开（`[...map.entries()]`）在默认 target 下编译报错，不要降回。
4. **seed 重复执行安全**：站点用 `ON CONFLICT ... DO UPDATE`（复用 key 会更新名称/域名），并清理不在演示集合的 `demo%` 旧站点。
5. **Redis 键 TTL = 窗口+2 天缓冲**：保证每批数据至少有两次归档机会才过期；调大 `RETENTION_DAYS` 注意 `docs/analysis/04` 的内存公式。
6. **限流/站点缓存都在 Redis**：多实例部署天然共享；不要改回进程内 Map。
7. **时区**：日期归属统一 `APP_TZ`（默认 Asia/Shanghai）由服务端判定，客户端时间不可信。

## 6. 二次开发常用任务指引

- **新增统计维度**（如浏览器/设备趋势）：采集侧在 `lib/hot.ts` pipeline 加对应键（进 `K`）→ 查询侧 `lib/stats.ts` 加混合查询（用 `redisDays`/`sqliteDays` 模式）→ `/api/stats` 响应与 `Dashboard.tsx` 展示。
- **新增页面**：详情类页面放 `app/site/[key]/` 下或新路由，鉴权用 `isAuthenticated()` + redirect(`/login`)（参考 `app/site/[key]/page.tsx`）。
- **改采集协议**（m.js ↔ /api/collect 参数）：`public/m.js` 的 `send()` 与 `app/api/collect/route.ts#handle` 两处同步改；GIF 兜底通道是逐个 query 参数，不是 JSON。
- **调 Redis 保留天数**：环境变量 `RETENTION_DAYS` 即可，无需改代码；改后重跑 seed 验证窗口边界。
- **验证改动**：见 §3 `verify.mjs` + `docs/plans/03` 的 V1–V10 清单（含预期值）。

## 7. 提交纪律

- 提交前 `npm run build` 必须通过（含 ESLint/类型）。
- 不提交：`data/`、`.env`、`node_modules/`（.gitignore 已覆盖，勿放宽）。
- 设计变更先更新 `docs/` 对应编号文档再动代码；文档状态列（执行中/已完成）随代码同步。
