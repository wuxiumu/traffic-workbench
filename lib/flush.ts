import { redis } from "@/lib/redis";
import { db, dateStr } from "@/lib/db";

/**
 * 每日归档任务：Redis 原始事件 → SQLite。
 *
 * 语义（幂等，可安全重跑/补跑）：
 * 1. SCAN 找到所有 tw:events:{key}:{date} 且 date < today 的键
 * 2. LRANGE 全量取出 → 批量 INSERT events 表 → DEL 该键
 * 3. 用 SQL 从 events 重算当日 daily_stats / page_daily / referrer_daily
 *    （INSERT OR REPLACE ... SELECT + COUNT DISTINCT，天然与 Redis 计数一致）
 * 4. 清理超过 ARCHIVE_DAYS 的归档事件
 *
 * 今日键跳过（仍在写入）；窗口计数键（stats/vis/ips/pages/refs）靠 TTL 自然过期。
 */

const ARCHIVE_DAYS = Math.max(
  parseInt(process.env.ARCHIVE_DAYS || "90", 10),
  1
);

export type FlushResult = {
  days: { siteKey: string; date: string; events: number }[];
  archived: number;
  cleaned: number;
  uDays: { domain: string; date: string; events: number }[];
  uArchived: number;
  durationMs: number;
};

export async function flushToSQLite(): Promise<FlushResult> {
  const t0 = Date.now();
  const today = dateStr();
  const days: FlushResult["days"] = [];
  const uDays: FlushResult["uDays"] = [];
  let archived = 0;
  let uArchived = 0;

  // 1. 找待归档的事件键
  const targets: { key: string; siteKey: string; date: string }[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      "tw:events:*",
      "COUNT",
      200
    );
    cursor = next;
    for (const k of keys) {
      // tw:events:{siteKey}:{date}
      const m = k.match(/^tw:events:([^:]+):(\d{4}-\d{2}-\d{2})$/);
      if (!m) continue;
      const [, siteKey, date] = m;
      if (date >= today) continue; // 今日仍在写，跳过
      targets.push({ key: k, siteKey, date });
    }
  } while (cursor !== "0");

  // 2. 逐站点逐日落库 + 重算聚合
  const insEvent = db.prepare(
    `INSERT INTO events (site_id, ts, date, path, referrer, visitor_id, ip_hash, ua)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const siteCache = new Map<string, number>();
  const siteId = async (key: string): Promise<number | null> => {
    if (siteCache.has(key)) return siteCache.get(key)!;
    const row = db.prepare("SELECT id FROM sites WHERE site_key = ?").get(key) as
      | { id: number }
      | undefined;
    const id = row ? row.id : null;
    siteCache.set(key, id ?? -1);
    return id;
  };

  for (const t of targets) {
    const sid = await siteId(t.siteKey);
    if (sid == null || sid === -1) {
      await redis.del(t.key); // 站点已删，丢弃孤儿数据
      continue;
    }
    const raw = await redis.lrange(t.key, 0, -1);
    if (raw.length === 0) {
      await redis.del(t.key);
      continue;
    }
    const tx = db.transaction(() => {
      const stmts: unknown[][] = [];
      for (const line of raw) {
        try {
          const e = JSON.parse(line) as {
            t: number; p: string; r: string; v: string; i: string; u: string;
          };
          stmts.push([sid, e.t, t.date, e.p, e.r ?? "", e.v, e.i ?? "", e.u ?? ""]);
        } catch {
          /* 跳过损坏行 */
        }
      }
      for (const args of stmts) insEvent.run(...(args as [number, number, string, string, string, string, string, string]));
      // 3. 由 events 重算当日聚合（幂等 REPLACE）
      recomputeDay(sid, t.date);
      return stmts.length;
    });
    const n = tx() as number;
    archived += n;
    days.push({ siteKey: t.siteKey, date: t.date, events: n });
    await redis.del(t.key);
  }

  // 3.5 万能统计归档（独立命名空间 tw:u:*，同样跳过今日）
  uArchived = await flushUniversal(today, uDays);

  // 4. 清理超期归档
  const cutoff = dateStr(new Date(Date.now() - ARCHIVE_DAYS * 86400000));
  const cleaned = db
    .prepare("DELETE FROM events WHERE date < ?")
    .run(cutoff).changes;
  db.prepare("DELETE FROM u_events WHERE date < ?").run(cutoff);

  return { days, archived, cleaned, uDays, uArchived, durationMs: Date.now() - t0 };
}

/** 用 events 表重算某站点某日的三张聚合表 */
export function recomputeDay(siteId: number, date: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO daily_stats (site_id, date, pv, uv, ip_count)
     SELECT site_id, date,
            COUNT(*)                                              AS pv,
            COUNT(DISTINCT visitor_id)                            AS uv,
            COUNT(DISTINCT CASE WHEN ip_hash != '' THEN ip_hash END) AS ip_count
     FROM events WHERE site_id = ? AND date = ?
     GROUP BY site_id, date`
  ).run(siteId, date);

  db.prepare(
    `INSERT OR REPLACE INTO page_daily (site_id, date, path, pv, uv)
     SELECT site_id, date, path, COUNT(*) pv, COUNT(DISTINCT visitor_id) uv
     FROM events WHERE site_id = ? AND date = ?
     GROUP BY site_id, date, path`
  ).run(siteId, date);

  db.prepare(
    `INSERT OR REPLACE INTO referrer_daily (site_id, date, referrer, pv)
     SELECT site_id, date, referrer, COUNT(*) pv
     FROM events WHERE site_id = ? AND date = ?
     GROUP BY site_id, date, referrer`
  ).run(siteId, date);
}

let flushing = false;
/** 防并发入口（cron 与手动触发共用） */
export async function flushOnce(): Promise<FlushResult | "busy"> {
  if (flushing) return "busy";
  flushing = true;
  try {
    return await flushToSQLite();
  } finally {
    flushing = false;
  }
}

/** 用 u_events 表重算某域名某日的 u_daily（口径同 recomputeDay） */
export function recomputeUDay(domain: string, date: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO u_daily (domain, date, pv, uv, ip_count)
     SELECT domain, date,
            COUNT(*)                                                 AS pv,
            COUNT(DISTINCT visitor_id)                               AS uv,
            COUNT(DISTINCT CASE WHEN ip_hash != '' THEN ip_hash END) AS ip_count
     FROM u_events WHERE domain = ? AND date = ?
     GROUP BY domain, date`
  ).run(domain, date);
}

/** 万能统计归档：SCAN tw:u:events:* → u_events 入库 → 重算 u_daily → DEL */
async function flushUniversal(
  today: string,
  uDays: FlushResult["uDays"]
): Promise<number> {
  const targets: { key: string; domain: string; date: string }[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "tw:u:events:*", "COUNT", 200);
    cursor = next;
    for (const k of keys) {
      const m = k.match(/^tw:u:events:([^:]+):(\d{4}-\d{2}-\d{2})$/);
      if (!m) continue;
      const [, domain, date] = m;
      if (date >= today) continue;
      targets.push({ key: k, domain, date });
    }
  } while (cursor !== "0");

  const ins = db.prepare(
    `INSERT INTO u_events (domain, ts, date, path, referrer, visitor_id, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  let n = 0;
  for (const t of targets) {
    const raw = await redis.lrange(t.key, 0, -1);
    if (raw.length === 0) {
      await redis.del(t.key);
      continue;
    }
    const tx = db.transaction(() => {
      let c = 0;
      for (const line of raw) {
        try {
          const e = JSON.parse(line) as {
            t: number; p: string; r: string; v: string; i: string;
          };
          ins.run(t.domain, e.t, t.date, e.p, e.r ?? "", e.v, e.i ?? "");
          c++;
        } catch {
          /* 跳过损坏行 */
        }
      }
      recomputeUDay(t.domain, t.date);
      return c;
    });
    const c = tx() as number;
    n += c;
    uDays.push({ domain: t.domain, date: t.date, events: c });
    await redis.del(t.key);
  }
  return n;
}
