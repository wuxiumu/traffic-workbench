# 流量统计工作台

自托管网站流量统计系统：统计网站页面的 **PV / UV / IP**，支持历史趋势、来源分析、实时访问动态、接入代码生成。

**v2 架构：Next.js + Redis 热存 + SQLite 归档**，Redis 承载近 N 天（默认 7 天，可配）全部实时数据，SQLite 只做历史日志归档，每天定时任务落库。面向 4 核 8GiB 单机 Docker 部署。

## 架构总览

```
网站嵌入 m.js
    │
    ▼
/api/collect ──────► Redis（实时窗口，RETENTION_DAYS 天，TTL 自动清理）
    热路径零 SQLite      ├─ HASH  tw:stats:{key}:{date}    PV/UV/IP 计数（HINCRBY）
                        ├─ SET   tw:vis/ips:{key}:{date}   UV/IP 按日去重（SADD）
                        ├─ ZSET  tw:pages/refs:{key}:{date} 页面/来源排行（ZINCRBY）
                        ├─ LIST  tw:events:{key}:{date}    原始事件日志（RPUSH+LTRIM）
                        └─ LIST  tw:feed:{key}             实时访问流（LPUSH+LTRIM 50）
    │
    │  每天 03:00 定时任务（node-cron / POST /api/cron/flush）
    ▼
SQLite（历史归档，data/traffic.db）
    ├─ events 表：原始事件归档（保留 ARCHIVE_DAYS 天）
    └─ daily_stats / page_daily / referrer_daily：
       由 events 重算的日聚合（INSERT OR REPLACE ... SELECT + COUNT DISTINCT）
```

**读路径混合查询**：窗口内日期一律取 Redis（实时、内存级）；更早日期取 SQLite。每个日期只从单一来源取数，无重复计数。

## 功能

- **采集端**：`<script>` 一行接入，sendBeacon + GIF 兜底，支持 SPA 路由，IP 只存哈希脱敏
- **万能统计**（`/universal` 独立大盘）：免注册 key，`<script src="…/u.js">` 放进任何网站即按域名自动统计；两模块「域名访问 / IP 统计」+ 14 天趋势；**页面停留满 3 秒才计 PV/UV/IP**（快速跳转或秒关不计，防误报）
- **首页总览大屏**：全部域名合计 PV/UV/IP 指标卡（昨日环比）、域名排名表（按今日 PV，含 30 天迷你趋势）、全站合计趋势（Redis+SQLite 拼接）
- **站点详情子页**（`/site/{key}`）：单站指标卡、7/30/90 天趋势、热门页面/来源排行、实时访问动态（10s 轮询）
- **站点管理**：添加/删除站点、一键复制接入代码；**多选批量操作**——导出数据（JSON，含事件明细，可用于备份/迁移）、清空统计数据（保留配置）、灌 30 天演示数据；**导入向导**（选择文件→勾选站点→按日期段幂等替换导入）
- **定时归档**：每日 cron 把 Redis 事件落 SQLite 并重算日聚合（幂等，可补跑）
- **鉴权**：管理员密码登录，HttpOnly Cookie
- **监控**：`/api/health`（含 Redis ping）+ `health-monitor.mjs` webhook 通知 + Docker healthcheck

## 快速开始（本地）

```bash
./tw.sh start --dev   # 一键环境检查（Node/依赖/Redis 自动拉起）+ 开发模式启动
./tw.sh stop | restart | status | logs -f
./tw.sh seed          # 演示数据：3 域名×30 天 + 万能统计 3 域名
```

或手动：`npm install && npm run seed && npm run build && npm start`（需本地 Redis：`redis-server --daemonize yes`）。默认密码 admin123。

## 服务器部署（4 核 8GiB）

### 0. 推荐方式：管理脚本一键部署

```bash
cat > .env <<'EOF'
ADMIN_PASSWORD=你的强密码
IP_SALT=一串随机字符串
CRON_SECRET=触发归档用的密钥
EOF

./tw.sh start --docker     # 环境检查 + docker compose 构建启动 + 健康等待
./tw.sh status --docker    # 容器状态 + 健康探针
./tw.sh logs -f --docker   # 跟踪日志
./tw.sh stop --docker      # 停止（docker compose down）
```

本地无 Docker 时 `--docker` 会给出明确安装提示；不带 `--docker` 则走本地进程模式（服务器上装了 Node + Redis 也可以直接 `./tw.sh start` 用进程方式部署）。

```bash
cd traffic-workbench

cat > .env <<'EOF'
ADMIN_PASSWORD=你的强密码
IP_SALT=一串随机字符串
CRON_SECRET=触发归档用的密钥
EOF

docker compose up -d --build   # 一次拉起 app + redis 两个容器
```

- app 只监听 `127.0.0.1:3000`，Redis 不对外暴露，由 Nginx 反代 HTTPS
- Redis 开启 AOF + 卷持久化，容器重启窗口数据不丢
- Nginx 反代必须传 `X-Forwarded-For`（真实 IP 统计依赖它）
- 网站接入：工作台「站点管理」→ 复制嵌入代码到目标网站 `<head>`

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | `admin123` | 管理员密码，**生产必须修改** |
| `IP_SALT` | 内置默认 | IP 哈希盐值 |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis 地址（容器内 `redis://redis:6379`） |
| `RETENTION_DAYS` | `7` | Redis 实时窗口天数（可配，≥1） |
| `FLUSH_CRON` | `0 3 * * *` | 归档定时任务 cron 表达式 |
| `CRON_SECRET` | 空 | 手动触发归档端点的密钥 |
| `ARCHIVE_DAYS` | `90` | SQLite events 归档保留天数 |
| `EVENTS_CAP_PER_DAY` | `100000` | 单站点单日 Redis 事件上限 |
| `RATE_LIMIT_PER_MIN` | `120` | 单 IP 每分钟上报上限 |
| `APP_TZ` | `Asia/Shanghai` | 统计日期归属时区 |
| `DATA_DIR` | `./data` | SQLite 目录 |

## 统计口径

- **PV**：每次页面加载（含 SPA 路由切换）+1
- **UV**：浏览器匿名访客 ID 按日去重（Redis SET；归档后 COUNT DISTINCT visitor_id）
- **IP**：客户端 IP 的 SHA-256 哈希按日去重（同口径）
- 归档聚合由 events 表重算，与 Redis 实时计数天然一致；flush 幂等可重跑

## 监控与备份

```bash
# 健康探针（Redis + SQLite + 磁盘/内存）
curl http://127.0.0.1:3000/api/health

# 异常/恢复 webhook 通知（飞书/钉钉/企微/Server酱），crontab 每 5 分钟
*/5 * * * * WEBHOOK_URL=... HEALTH_URL=... node /path/scripts/health-monitor.mjs

# 手动触发归档（验证/补跑）
curl -X POST -H "X-Cron-Secret: $CRON_SECRET" http://127.0.0.1:3000/api/cron/flush

# 备份：SQLite 单文件 + Redis AOF 卷
cp data/traffic.db backup/traffic-$(date +%F).db
```

## 文档

详细分析与执行计划见 [`docs/`](docs/)：

- [`docs/analysis/`](docs/analysis/) — 需求、现状、架构、容量、[商业化建议](docs/analysis/05-商业化建议.md)
- [`docs/plans/`](docs/plans/) — 架构升级执行计划、模块明细、验证上线
- [`AGENTS.md`](AGENTS.md) — AI 智能体/新人开发指南（架构不变量、命令、二次开发指引）

改动代码前先读 AGENTS.md §2 的五条架构不变量；改动后跑 `node scripts/verify.mjs` 冒烟验证。

## 项目结构

```
app/api/collect     # 采集上报（Redis 限流 + 热路径 pipeline 写入）
app/api/u           # 万能统计采集（免 key，按域名自动注册，3 秒停留由 u.js 判定）
app/api/universal   # 万能统计独立大盘数据
app/api/overview    # 首页大屏：全站合计 + 域名排名 + 合计趋势
app/api/stats       # 站点详情数据（Redis 窗口 + SQLite 历史混合查询）
app/api/feed        # 实时访问流轻量轮询端点
app/api/cron/flush  # 手动归档触发（X-Cron-Secret 保护）
app/api/sites|auth|health
app/site/[key]      # 单站点详情子页
app/universal       # 万能统计独立大盘页
components/Overview.tsx    # 首页总览大屏
components/UniversalBoard.tsx  # 万能统计大盘（域名访问/IP 统计两模块）
components/Dashboard.tsx   # 站点详情（fixedKey 子页模式）
lib/redis.ts        # ioredis 单例 + key 设计（K keyed / K_U 万能） + RETENTION_DAYS
lib/universal.ts    # 万能统计热路径 + 大盘查询（tw:u:* 独立命名空间）
lib/hot.ts          # 采集热路径（零 SQLite 写入）
lib/flush.ts        # 归档任务（幂等）+ 日聚合重算
lib/scheduler.ts    # 归档 cron（health 探活按需拉起，替代 instrumentation）
lib/stats.ts        # 混合查询层
lib/db.ts|track.ts|auth.ts
public/m.js         # 嵌入统计脚本
scripts/seed.mjs    # 演示数据（双路径写入）
scripts/health-monitor.mjs
```
