/**
 * 演示数据生成（v2 双路径）：
 *   - 窗口内（近 RETENTION_DAYS 天）→ 写 Redis（与线上 hot.ts 完全同构的键与格式）
 *   - 更早日期 → 写 SQLite events + 日聚合（与 recomputeDay 同口径）
 * 用法：node scripts/seed.mjs [总天数，默认30]
 */
import Database from "better-sqlite3";
import Redis from "ioredis";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const TOTAL_DAYS = parseInt(process.argv[2] ?? "30", 10);
const RETENTION_DAYS = Math.max(1, parseInt(process.env.RETENTION_DAYS || "7", 10));
const DATA_DIR = path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "traffic.db"));
db.pragma("journal_mode = WAL");
const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");

function dateStr(offsetDays = 0) {
  const d = new Date(Date.now() - offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TZ || "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT '', site_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL, ts INTEGER NOT NULL,
    date TEXT NOT NULL, path TEXT NOT NULL, referrer TEXT NOT NULL DEFAULT '',
    visitor_id TEXT NOT NULL, ip_hash TEXT NOT NULL DEFAULT '', ua TEXT NOT NULL DEFAULT '');
  CREATE INDEX IF NOT EXISTS idx_events_site_ts ON events(site_id, ts);
  CREATE TABLE IF NOT EXISTS daily_stats (
    site_id INTEGER NOT NULL, date TEXT NOT NULL, pv INTEGER NOT NULL DEFAULT 0,
    uv INTEGER NOT NULL DEFAULT 0, ip_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, date));
  CREATE TABLE IF NOT EXISTS page_daily (
    site_id INTEGER NOT NULL, date TEXT NOT NULL, path TEXT NOT NULL,
    pv INTEGER NOT NULL DEFAULT 0, uv INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, date, path));
  CREATE TABLE IF NOT EXISTS referrer_daily (
    site_id INTEGER NOT NULL, date TEXT NOT NULL, referrer TEXT NOT NULL,
    pv INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (site_id, date, referrer));
`);

const demoSites = [
  { key: "demo0001", name: "我的博客", domain: "blog.example.com", scale: 1 },
  { key: "demo0002", name: "产品文档", domain: "docs.example.com", scale: 0.6 },
  { key: "demo0003", name: "商城官网", domain: "shop.example.com", scale: 1.4 },
];
const insSite = db.prepare(
  `INSERT INTO sites (name, domain, site_key, created_at) VALUES (?, ?, ?, ?)
   ON CONFLICT(site_key) DO UPDATE SET name = excluded.name, domain = excluded.domain`
);
for (const s of demoSites) insSite.run(s.name, s.domain, s.key, Date.now());

// 清理不在当前演示集合里的旧 demo 站点（含数据）
{
  const keep = demoSites.map((s) => `'${s.key}'`).join(",");
  const stale = db
    .prepare(`SELECT id, site_key FROM sites WHERE site_key LIKE 'demo%' AND site_key NOT IN (${keep})`)
    .all();
  for (const s of stale) {
    for (const t of ["events", "daily_stats", "page_daily", "referrer_daily"]) {
      db.prepare(`DELETE FROM ${t} WHERE site_id = ?`).run(s.id);
    }
    db.prepare("DELETE FROM sites WHERE id = ?").run(s.id);
    console.log(`清理旧演示站点: ${s.site_key}`);
  }
}

// 清空旧数据（SQLite + Redis tw:*）
for (const t of ["events", "daily_stats", "page_daily", "referrer_daily"]) {
  db.exec(`DELETE FROM ${t}`);
}
{
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "tw:*", "COUNT", 500);
    cursor = next;
    if (keys.length) await redis.del(...keys);
  } while (cursor !== "0");
}

const PAGES = ["/", "/posts", "/posts/hello-world", "/about", "/archive", "/tags"];
const REFS = ["", "", "", "google.com", "baidu.com", "bing.com", "zhihu.com", "github.com", "weibo.com"];
const UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/126 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ... Mobile Safari",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Edg/126",
  "Mozilla/5.0 (Linux; Android 14) ... Mobile Safari",
];
const ipHash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
const dayTs = (offsetDays, hour) =>
  Date.now() - offsetDays * 86400000 - (23 - hour) * 3600000 - Math.floor(Math.random() * 3600000);

// 每天的事件先在内存生成（两侧共用同一生成逻辑，保证口径一致）
function genDay(sid, offsetDays, scale) {
  const date = dateStr(offsetDays);
  const base = Math.round((40 + (TOTAL_DAYS - offsetDays) * 1.2) * scale);
  const weekend = [0, 6].includes(new Date(date + "T00:00:00Z").getUTCDay()) ? 0.7 : 1;
  const pv = Math.round(base * weekend * (0.8 + Math.random() * 0.5));
  const visitors = Math.max(1, Math.round(pv / (2 + Math.random() * 1.5)));
  const ips = Math.max(1, Math.round(visitors * (0.85 + Math.random() * 0.2)));
  const events = [];
  const visSet = new Set(), ipSet = new Set();
  for (let i = 0; i < pv; i++) {
    const vid = `v${sid}-${Math.floor(Math.random() * visitors)}`;
    events.push({
      t: dayTs(offsetDays, Math.floor(Math.random() * 24)),
      p: PAGES[Math.floor(Math.random() * PAGES.length)],
      r: REFS[Math.floor(Math.random() * REFS.length)],
      v: vid,
      i: ipHash(`ip-${sid}-${Math.floor(Math.random() * ips)}`),
      u: UAS[Math.floor(Math.random() * UAS.length)],
    });
    visSet.add(vid);
    events[events.length - 1].ih = events[events.length - 1].i;
    ipSet.add(events[events.length - 1].i);
  }
  return { date, events, visSet, ipSet };
}

const insEvent = db.prepare(
  "INSERT INTO events (site_id, ts, date, path, referrer, visitor_id, ip_hash, ua) VALUES (?,?,?,?,?,?,?,?)"
);

let redisDays = 0, sqliteDays = 0;

for (const s of demoSites) {
  const sid = db.prepare("SELECT id FROM sites WHERE site_key = ?").get(s.key).id;
  const inWindow = (d) => d < RETENTION_DAYS; // offset 0=今天 … RETENTION-1 都在窗口内
  const TTL = (RETENTION_DAYS + 2) * 86400;

  for (let d = TOTAL_DAYS - 1; d >= 0; d--) {
    const { date, events, visSet, ipSet } = genDay(sid, d, s.scale);

    if (inWindow(d)) {
      // ---- Redis 路径（与 hot.ts 同构）----
      const pl = redis.pipeline();
      for (const e of events) {
        pl.rpush(`tw:events:${s.key}:${date}`, JSON.stringify({ t: e.t, p: e.p, r: e.r, v: e.v, i: e.i, u: e.u }));
        pl.zincrby(`tw:pages:${s.key}:${date}`, 1, e.p);
        pl.zincrby(`tw:refs:${s.key}:${date}`, 1, e.r || "direct");
      }
      for (const v of visSet) pl.sadd(`tw:vis:${s.key}:${date}`, v);
      for (const h of ipSet) pl.sadd(`tw:ips:${s.key}:${date}`, h);
      pl.hset(`tw:stats:${s.key}:${date}`, {
        pv: events.length, uv: visSet.size, ip: ipSet.size,
      });
      for (const pre of ["stats", "vis", "ips", "pages", "refs", "events"]) {
        pl.expire(`tw:${pre}:${s.key}:${date}`, TTL);
      }
      await pl.exec();
      // feed：今天才灌实时流
      if (d === 0) {
        const feedPl = redis.pipeline();
        for (const e of events.slice(0, 20).reverse()) {
          feedPl.lpush(
            `tw:feed:${s.key}`,
            JSON.stringify({ t: e.t, p: e.p, r: e.r, d: /iPhone|Android/.test(e.u) ? "mobile" : "desktop" })
          );
        }
        feedPl.ltrim(`tw:feed:${s.key}`, 0, 49);
        feedPl.expire(`tw:feed:${s.key}`, 7 * 86400);
        await feedPl.exec();
      }
      redisDays++;
    } else {
      // ---- SQLite 路径（与 recomputeDay 同口径）----
      const tx = db.transaction(() => {
        for (const e of events) {
          insEvent.run(sid, e.t, date, e.p, e.r, e.v, e.i, e.u);
        }
        db.prepare(
          `INSERT OR REPLACE INTO daily_stats (site_id, date, pv, uv, ip_count)
           SELECT site_id, date, COUNT(*) pv, COUNT(DISTINCT visitor_id) uv,
                  COUNT(DISTINCT CASE WHEN ip_hash != '' THEN ip_hash END) ip_count
           FROM events WHERE site_id = ? AND date = ? GROUP BY site_id, date`
        ).run(sid, date);
        db.prepare(
          `INSERT OR REPLACE INTO page_daily (site_id, date, path, pv, uv)
           SELECT site_id, date, path, COUNT(*) pv, COUNT(DISTINCT visitor_id) uv
           FROM events WHERE site_id = ? AND date = ? GROUP BY site_id, date, path`
        ).run(sid, date);
        db.prepare(
          `INSERT OR REPLACE INTO referrer_daily (site_id, date, referrer, pv)
           SELECT site_id, date, referrer, COUNT(*) pv
           FROM events WHERE site_id = ? AND date = ? GROUP BY site_id, date, referrer`
        ).run(sid, date);
      });
      tx();
      sqliteDays++;
    }
  }
}

// 打印两侧概览，便于断言
const redisToday = await redis.hgetall(`tw:stats:demo0001:${dateStr(0)}`);
const sqliteHist = db
  .prepare("SELECT COUNT(DISTINCT date) d, SUM(pv) pv FROM daily_stats")
  .get();
console.log(
  `✅ seed 完成：Redis 窗口 ${redisDays} 站·天（RETENTION_DAYS=${RETENTION_DAYS}），SQLite 归档 ${sqliteDays} 站·天`
);
console.log(`   Redis 今日 demo0001:`, JSON.stringify(redisToday));
console.log(`   SQLite 历史段: ${sqliteHist.d} 个站·天, 共 ${sqliteHist.pv} PV`);
redis.disconnect();
