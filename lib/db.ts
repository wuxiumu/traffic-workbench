import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// SQLite 数据库文件位置：可通过 DATA_DIR 环境变量重定向（Docker 挂载卷用）
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "traffic.db");

declare global {
  // eslint-disable-next-line no-var
  var __twDB: Database.Database | undefined;
}

export const db: Database.Database =
  global.__twDB ?? new Database(DB_PATH);

// WAL 模式：写并发更友好，掉电安全
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");

global.__twDB = db;

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT '',
      site_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,            -- 毫秒时间戳
      date TEXT NOT NULL,             -- yyyy-mm-dd（APP_TZ 时区）
      path TEXT NOT NULL,
      referrer TEXT NOT NULL DEFAULT '',   -- 归一化后的来源 host
      visitor_id TEXT NOT NULL,
      ip_hash TEXT NOT NULL DEFAULT '',
      ua TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_events_site_ts ON events(site_id, ts);
    CREATE INDEX IF NOT EXISTS idx_events_site_date ON events(site_id, date);

    -- 日汇总：历史段趋势/大盘查询（窗口内实时数据在 Redis）
    --         由归档任务从 events 重算（lib/flush.ts recomputeDay）
    CREATE TABLE IF NOT EXISTS daily_stats (
      site_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      pv INTEGER NOT NULL DEFAULT 0,
      uv INTEGER NOT NULL DEFAULT 0,
      ip_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, date)
    );

    -- 页面维度日汇总（Top 页面）
    CREATE TABLE IF NOT EXISTS page_daily (
      site_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      path TEXT NOT NULL,
      pv INTEGER NOT NULL DEFAULT 0,
      uv INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, date, path)
    );

    -- 来源维度日汇总（Top 来源）
    CREATE TABLE IF NOT EXISTS referrer_daily (
      site_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      referrer TEXT NOT NULL,
      pv INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, date, referrer)
    );
  `);
}

initSchema();

/** 按 APP_TZ（默认东八区）取 yyyy-mm-dd 字符串 */
export function dateStr(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TZ || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function now(): number {
  return Date.now();
}
