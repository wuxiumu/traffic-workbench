# 03 · Redis + SQLite 混合存储架构分析

> 状态：已确认 ｜ 关联：`docs/plans/02-模块改造明细计划.md`

## 1. 分层原则

**Redis = 实时窗口（热）**，`RETENTION_DAYS` 天（默认 7，可配）内的全部数据；
**SQLite = 历史归档（冷）**，原始事件日志 + 由事件重算的日聚合。

窗口边界定义：`windowStart = today - (RETENTION_DAYS - 1)`。**每个日期只从一个来源读**：`date >= windowStart` 取 Redis，更早取 SQLite —— 天然无重复计数，无需对账。

## 2. Redis key 设计（按结构选型）

| Key（模式） | 类型 | 写入 | 读取方 | TTL |
|---|---|---|---|---|
| `tw:stats:{key}:{date}` | HASH `{pv,uv,ip}` | HINCRBY | summary/trend/total | 窗口+2天 |
| `tw:vis:{key}:{date}` | SET 访客ID | SADD（返回1→uv+1） | 仅写 | 同上 |
| `tw:ips:{key}:{date}` | SET IP哈希 | SADD（返回1→ip+1） | 仅写 | 同上 |
| `tw:pages:{key}:{date}` | ZSET path→pv | ZINCRBY | 排行榜 ZREVRANGE | 同上 |
| `tw:refs:{key}:{date}` | ZSET ref→pv | ZINCRBY | 排行榜 | 同上 |
| `tw:events:{key}:{date}` | LIST 原始事件 JSON | RPUSH + LTRIM 上限 | **归档任务** | 同上 |
| `tw:feed:{key}` | LIST 最新访问流 | LPUSH + LTRIM 0 49 | 实时动态卡 | 7天 |
| `tw:site:{key}` | STRING `id\|domain` | SETEX 300 | 采集站点缓存 | 300s |
| `tw:rl:{ipHash}:{minute}` | STRING 计数 | INCR + EXPIRE 60 | 限流 | 60s |

选型理由：
- **HASH+HINCRBY**：三指标单键原子自增，一次 HGETALL 拿全天计数
- **SET+SADD 返回值**：去重与新增量判定一步完成，替代 v1 的去重表
- **ZSET+ZINCRBY**：排行榜天然有序，ZREVRANGE WITHSCORES 直接出 Top N
- **LIST+RPUSH/LTRIM**：事件日志按序追加 + 容量封顶；feed 用 LPUSH+LTRIM 滑窗
- **TTL**：窗口键统一 `RETENTION_DAYS+2` 天缓冲，保证归档至少两次机会后才过期

## 3. 采集热路径（lib/hot.ts）

```
1. 限流：INCR tw:rl:{ipHash}:{minute}（Redis 原生限流，跨实例有效）
2. 站点解析：GET tw:site:{key}，未命中回源 SQLite 并 SETEX 300
3. pipeline 一次性批量：
   SADD vis / SADD ips / HINCRBY pv / ZINCRBY pages / ZINCRBY refs
   RPUSH events(JSON) + LTRIM 封顶 / LPUSH feed + LTRIM 50
   EXPIRE × 8（幂等）
4. 依据 SADD 返回值补 HINCRBY uv / ip（第二次小 pipeline）
```

SQLite 在热路径上最多出现一次缓存未命中的**读**，永不写。

## 4. 归档任务（lib/flush.ts，每日 cron）

```
1. SCAN tw:events:* → 解析出 date < today 的键（今日跳过）
2. 逐键 LRANGE 全量 → 事务批量 INSERT events 表 → DEL 键
3. 重算该日聚合（幂等）：
   INSERT OR REPLACE INTO daily_stats
     SELECT ..., COUNT(*) pv, COUNT(DISTINCT visitor_id) uv,
                COUNT(DISTINCT ip_hash) ip FROM events WHERE site_id=? AND date=?
   page_daily / referrer_daily 同理
4. DELETE events WHERE date < today - ARCHIVE_DAYS（归档瘦身）
```

幂等性来源：聚合行由 events **重算**（REPLACE）而非增量累加 —— 重跑、补跑、启动补跑（延迟 30s）都安全。计数键（stats/vis/…）无需归档，靠 TTL 自然消亡。

## 5. 读路径混合查询（lib/stats.ts）

| 查询 | 逻辑 |
|---|---|
| 今日/昨日指标 | 窗口内 → Redis HGETALL；窗口外（如 RETENTION=1 的昨天）→ SQLite |
| 趋势 N 天 | 逐日判定来源：窗口内 pipeline HGETALL 补零；更早查 daily_stats；拼接连续序列 |
| total | SQLite SUM(date < windowStart) + Redis 窗口求和 |
| 排行（区间） | SQLite GROUP BY（date < windowStart）+ Redis 各日 ZREVRANGE WITHSCORES，JS 合并 |
| 实时动态 | LRANGE feed 0 19，Dashboard 10s 轮询 |

## 6. 关键取舍

1. **页面排行去掉 UV 列**：页面级 UV 去重需要每页一套 SET（键爆炸），ZSET 做不到低成本去重；排行以 PV 为准（归档侧 page_daily 仍有 UV，可后续在「历史视图」展示）。
2. **Redis 重启风险**：窗口数据可能丢（历史在 SQLite 不受影响）→ 开 AOF + 卷持久化兜底。
3. **事件日上限**（默认 10 万/站/日）：防异常流量撑爆内存，超限丢最老（LTRIM），文档标注。
4. **站点表留 SQLite**：低频配置数据，不值得进 Redis；采集侧用 300s 缓存消化读放大。
