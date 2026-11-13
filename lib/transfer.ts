import { redis, K, RETENTION_DAYS } from "@/lib/redis";
import { db, dateStr } from "@/lib/db";
import { recomputeDay } from "@/lib/flush";

/**
 * 站点数据导出/导入（多选）。
 *
 * 导出：events = SQLite 归档段 ∪ Redis 窗口段（完整）；
 * 导入：按日期段替换（幂等），聚合由 events 重算，口径与线上完全一致。
 */

export type ExportEvent = {
  key: string;
  ts: number;
  date: string;
  path: string;
  referrer: string;
  visitorId: string;
  ipHash: string;
};

export type ExportPayload = {
  version: 1;
  exportedAt: number;
  sites: { key: string; name: string; domain: string; createdAt: number }[];
  events: ExportEvent[];
};

/** 多选导出 */
export async function exportSites(siteKeys: string[]): Promise<ExportPayload> {
  const ws = dateStr(new Date(Date.now() - (RETENTION_DAYS - 1) * 86400000));
  const today = dateStr();

  const sites = db
    .prepare(
      `SELECT site_key, name, domain, created_at FROM sites WHERE site_key IN (${siteKeys.map(() => "?").join(",")})`
    )
    .all(...siteKeys) as { site_key: string; name: string; domain: string; created_at: number }[];
  const idByKey = new Map(
    (db.prepare("SELECT id, site_key FROM sites").all() as { id: number; site_key: string }[]).map(
      (r) => [r.site_key, r.id]
    )
  );

  // SQLite 归档段
  const events: ExportEvent[] = [];
  const sel = db.prepare(
    "SELECT ts, date, path, referrer, visitor_id, ip_hash FROM events WHERE site_id = ? AND date < ?"
  );
  for (const s of sites) {
    const sid = idByKey.get(s.site_key)!;
    for (const r of sel.all(sid, ws) as { ts: number; date: string; path: string; referrer: string; visitor_id: string; ip_hash: string }[]) {
      events.push({
        key: s.site_key, ts: r.ts, date: r.date, path: r.path,
        referrer: r.referrer, visitorId: r.visitor_id, ipHash: r.ip_hash,
      });
    }
  }

  // Redis 窗口段（ws..today，逐站点逐日 LRANGE pipeline）
  const pl = redis.pipeline();
  const dateList: string[] = [];
  for (let d = new Date(ws + "T00:00:00Z").getTime(); d <= new Date(today + "T00:00:00Z").getTime(); d += 86400000) {
    dateList.push(new Date(d).toISOString().slice(0, 10));
  }
  for (const s of sites) {
    for (const d of dateList) pl.lrange(K.events(s.site_key, d), 0, -1);
  }
  const res = await pl.exec();
  let i = 0;
  for (const s of sites) {
    for (const d of dateList) {
      const rows = (res![i++][1] as string[]) ?? [];
      for (const line of rows) {
        try {
          const e = JSON.parse(line) as { t: number; p: string; r: string; v: string; i: string };
          events.push({
            key: s.site_key, ts: e.t, date: d, path: e.p,
            referrer: e.r ?? "", visitorId: e.v, ipHash: e.i ?? "",
          });
        } catch {
          /* 跳过损坏行 */
        }
      }
    }
  }

  return {
    version: 1,
    exportedAt: Date.now(),
    sites: sites.map((s) => ({ key: s.site_key, name: s.name, domain: s.domain, createdAt: s.created_at })),
    events,
  };
}

export type ImportItem = { key: string; name?: string; domain?: string };
export type ImportSummary = {
  site: string;
  created: boolean;
  eventsImported: number;
  dates: string[];
};

/** 多选导入：按日期段替换（幂等），聚合重算。
 *  窗口内日期必须重建 Redis 聚合键（查询层窗口日只读 Redis——单一数据源不变量）。 */
export async function importSites(
  payload: ExportPayload,
  selectedKeys: string[]
): Promise<ImportSummary[]> {
  if (payload?.version !== 1 || !Array.isArray(payload.sites) || !Array.isArray(payload.events)) {
    throw new Error("格式错误：缺少 version/sites/events");
  }
  const chosen = payload.sites.filter((s) => selectedKeys.includes(s.key));
  const out: ImportSummary[] = [];
  const ws = dateStr(new Date(Date.now() - (RETENTION_DAYS - 1) * 86400000));
  const TTL = (RETENTION_DAYS + 2) * 86400;

  const upsertSite = db.prepare(
    `INSERT INTO sites (name, domain, site_key, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(site_key) DO UPDATE SET name = excluded.name, domain = excluded.domain`
  );
  const getId = db.prepare("SELECT id FROM sites WHERE site_key = ?");
  const delRange = db.prepare("DELETE FROM events WHERE site_id = ? AND date >= ? AND date <= ?");
  const insEvent = db.prepare(
    `INSERT INTO events (site_id, ts, date, path, referrer, visitor_id, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  for (const s of chosen) {
    const created = !getId.get(s.key);
    upsertSite.run(s.name ?? s.key, s.domain ?? "", s.key, s.createdAt ?? Date.now());
    const sid = (getId.get(s.key) as { id: number }).id;

    const siteEvents = payload.events.filter((e) => e.key === s.key);
    const dates = [...new Set(siteEvents.map((e) => e.date))].sort();
    const minD = dates[0] ?? dateStr();
    const maxD = dates[dates.length - 1] ?? minD;

    const tx = db.transaction(() => {
      delRange.run(sid, minD, maxD);
      for (const e of siteEvents) {
        insEvent.run(sid, e.ts, e.date, e.path, e.referrer ?? "", e.visitorId, e.ipHash ?? "");
      }
      for (const d of dates) recomputeDay(sid, d);
    });
    tx();

    // 窗口内日期：替换语义 — 清旧键并从导入事件重建 Redis 聚合（含 events LIST，供后续归档）
    const hotDates = dates.filter((d) => d >= ws);
    for (const d of hotDates) {
      await redis.del(
        K.stats(s.key, d), K.vis(s.key, d), K.ips(s.key, d),
        K.pages(s.key, d), K.refs(s.key, d), K.events(s.key, d)
      );
    }
    if (hotDates.length > 0) {
      const byDate = new Map(hotDates.map((d) => [d, [] as typeof siteEvents]));
      for (const e of siteEvents) {
        if (e.date >= ws) byDate.get(e.date)?.push(e);
      }
      for (const [d, evts] of byDate) {
        const pl = redis.pipeline();
        const vis = new Set<string>(), ips = new Set<string>();
        for (const e of evts) {
          pl.sadd(K.vis(s.key, d), e.visitorId);
          if (e.ipHash) pl.sadd(K.ips(s.key, d), e.ipHash);
          pl.zincrby(K.pages(s.key, d), 1, e.path);
          pl.zincrby(K.refs(s.key, d), 1, e.referrer || "direct");
          pl.rpush(K.events(s.key, d), JSON.stringify({
            t: e.ts, p: e.path, r: e.referrer, v: e.visitorId, i: e.ipHash,
          }));
          vis.add(e.visitorId);
          if (e.ipHash) ips.add(e.ipHash);
        }
        pl.hset(K.stats(s.key, d), { pv: evts.length, uv: vis.size, ip: ips.size });
        for (const pre of ["stats", "vis", "ips", "pages", "refs", "events"]) {
          pl.expire(`tw:${pre}:${s.key}:${d}`, TTL);
        }
        await pl.exec();
      }
    }

    out.push({ site: s.key, created, eventsImported: siteEvents.length, dates });
  }
  return out;
}
