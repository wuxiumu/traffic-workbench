import { db, dateStr } from "@/lib/db";
import { redis, K, RETENTION_DAYS } from "@/lib/redis";

/**
 * 混合查询层：
 * 窗口内（date >= windowStart）→ Redis 实时数据；
 * 更早日期 → SQLite 归档聚合。
 * 每个日期只从单一来源取数，无重复计数。
 */

export type SiteRow = { id: number; name: string; domain: string; site_key: string };

export function listSites(): SiteRow[] {
  return db
    .prepare("SELECT id, name, domain, site_key FROM sites ORDER BY id")
    .all() as SiteRow[];
}

function siteId(siteKey: string): number | null {
  const row = db.prepare("SELECT id FROM sites WHERE site_key = ?").get(siteKey) as
    | { id: number }
    | undefined;
  return row ? row.id : null;
}

function windowStart(): string {
  return dateStr(new Date(Date.now() - (RETENTION_DAYS - 1) * 86400000));
}

/** [from, to] 闭区间日期列表 */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const t = new Date(to + "T00:00:00Z").getTime();
  const f = new Date(from + "T00:00:00Z").getTime();
  for (let ts = f; ts <= t; ts += 86400000) {
    out.push(new Date(ts).toISOString().slice(0, 10));
  }
  return out;
}

type DayCount = { pv: number; uv: number; ip: number };

/** Redis 窗口内单日计数（缺键补零） */
async function redisDay(siteKey: string, date: string): Promise<DayCount> {
  const r = (await redis.hgetall(K.stats(siteKey, date))) as Record<string, string>;
  return {
    pv: Number(r.pv ?? 0),
    uv: Number(r.uv ?? 0),
    ip: Number(r.ip ?? 0),
  };
}

/** Redis 窗口内多日计数（pipeline 一次往返） */
async function redisDays(siteKey: string, dates: string[]): Promise<Map<string, DayCount>> {
  if (dates.length === 0) return new Map();
  const pl = redis.pipeline();
  for (const d of dates) pl.hgetall(K.stats(siteKey, d));
  const res = await pl.exec();
  const map = new Map<string, DayCount>();
  dates.forEach((d, i) => {
    const r = (res![i][1] as Record<string, string>) ?? {};
    map.set(d, {
      pv: Number(r.pv ?? 0),
      uv: Number(r.uv ?? 0),
      ip: Number(r.ip ?? 0),
    });
  });
  return map;
}

/** SQLite 归档段单日计数（缺行补零） */
function sqliteDays(sid: number, dates: string[]): Map<string, DayCount> {
  const map = new Map<string, DayCount>();
  if (dates.length === 0) return map;
  const placeholders = dates.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT date, pv, uv, ip_count FROM daily_stats
       WHERE site_id = ? AND date IN (${placeholders})`
    )
    .all(sid, ...dates) as { date: string; pv: number; uv: number; ip_count: number }[];
  for (const r of rows) map.set(r.date, { pv: r.pv, uv: r.uv, ip: r.ip_count });
  return map;
}

/** ---------- summary ---------- */

export type Summary = {
  today: DayCount;
  yesterday: DayCount;
  total: DayCount;
};

export async function summary(siteKey: string): Promise<Summary> {
  const sid = siteId(siteKey);
  if (!sid) {
    return {
      today: { pv: 0, uv: 0, ip: 0 },
      yesterday: { pv: 0, uv: 0, ip: 0 },
      total: { pv: 0, uv: 0, ip: 0 },
    };
  }
  const today = dateStr();
  const yesterday = dateStr(new Date(Date.now() - 86400000));
  const ws = windowStart();

  const [todayC, yestC] = await Promise.all([
    today >= ws
      ? redisDay(siteKey, today)
      : Promise.resolve(
          (sqliteDays(sid, [today]).get(today) ?? { pv: 0, uv: 0, ip: 0 })
        ),
    yesterday >= ws
      ? redisDay(siteKey, yesterday)
      : Promise.resolve(
          (sqliteDays(sid, [yesterday]).get(yesterday) ?? { pv: 0, uv: 0, ip: 0 })
        ),
  ]);

  // total = SQLite 历史累计 + Redis 窗口累计
  const hist = db
    .prepare(
      `SELECT COALESCE(SUM(pv),0) pv, COALESCE(SUM(uv),0) uv, COALESCE(SUM(ip_count),0) ip
       FROM daily_stats WHERE site_id = ? AND date < ?`
    )
    .get(sid, ws) as { pv: number; uv: number; ip: number };
  const winDates = datesBetween(ws, today);
  const win = await redisDays(siteKey, winDates);
  let wpv = 0, wuv = 0, wip = 0;
  for (const d of winDates) {
    const c = win.get(d)!;
    wpv += c.pv; wuv += c.uv; wip += c.ip;
  }
  return {
    today: todayC,
    yesterday: yestC,
    total: { pv: hist.pv + wpv, uv: hist.uv + wuv, ip: hist.ip + wip },
  };
}

/** ---------- 趋势 ---------- */

export type DayStat = { date: string; pv: number; uv: number; ip_count: number };

export async function dailySeries(siteKey: string, days: number): Promise<DayStat[]> {
  const sid = siteId(siteKey);
  if (!sid) return [];
  const today = dateStr();
  const from = dateStr(new Date(Date.now() - (days - 1) * 86400000));
  const ws = windowStart();
  const all = datesBetween(from, today);

  const hotDates = all.filter((d) => d >= ws);
  const coldDates = all.filter((d) => d < ws);

  const [hotMap, coldMap] = await Promise.all([
    redisDays(siteKey, hotDates),
    Promise.resolve(sqliteDays(sid, coldDates)),
  ]);

  return all.map((d) => {
    const c =
      d >= ws
        ? hotMap.get(d) ?? { pv: 0, uv: 0, ip: 0 }
        : coldMap.get(d) ?? { pv: 0, uv: 0, ip: 0 };
    return { date: d, pv: c.pv, uv: c.uv, ip_count: c.ip };
  });
}

/** ---------- 排行（区间合并） ---------- */

export type RankRow = { name: string; pv: number };

/** 来源名归一化：Redis 侧 ZSET 用 "direct"、SQLite 侧用 ""，统一展示为「直接访问」 */
const DIRECT = "直接访问";
function normRef(name: string): string {
  return name === "direct" || name === "" ? DIRECT : name;
}

export type DetailData = { pages: RankRow[]; referrers: RankRow[] };

type PvMap = Map<string, number>;

function mergeMaps(a: PvMap, b: PvMap): PvMap {
  const out = new Map(a);
  b.forEach((v, k) => out.set(k, (out.get(k) ?? 0) + v));
  return out;
}

function topN(map: PvMap, limit: number): RankRow[] {
  return [...map.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, limit)
    .map(([name, pv]) => ({ name, pv }));
}

async function zsetRange(siteKey: string, kind: "pages" | "refs", dates: string[]): Promise<PvMap> {
  const map: PvMap = new Map();
  if (dates.length === 0) return map;
  const pl = redis.pipeline();
  for (const d of dates) pl.zrevrange(K[kind](siteKey, d), 0, -1, "WITHSCORES");
  const res = await pl.exec();
  dates.forEach((_, i) => {
    const rows = (res![i][1] as string[]) ?? [];
    for (let j = 0; j + 1 < rows.length; j += 2) {
      const member = rows[j];
      const score = Number(rows[j + 1]);
      map.set(member, (map.get(member) ?? 0) + score);
    }
  });
  return map;
}

function sqliteRank(
  table: "page_daily" | "referrer_daily",
  sid: number,
  from: string,
  to: string
): PvMap {
  const col = table === "page_daily" ? "path" : "referrer";
  const rows = db
    .prepare(
      `SELECT ${col} name, SUM(pv) pv FROM ${table}
       WHERE site_id = ? AND date >= ? AND date <= ?
       GROUP BY name`
    )
    .all(sid, from, to) as { name: string; pv: number }[];
  return new Map(rows.map((r) => [r.name, r.pv]));
}

export async function details(siteKey: string, days: number, limit = 10): Promise<DetailData> {
  const sid = siteId(siteKey);
  if (!sid) return { pages: [], referrers: [] };
  const today = dateStr();
  const from = dateStr(new Date(Date.now() - (days - 1) * 86400000));
  const ws = windowStart();

  // 边界：区间与窗口的交集（Redis 段日期）
  const hotDates = datesBetween(from > ws ? from : ws, today);
  const coldFrom = from;
  const coldTo = hotDates.length > 0 ? prevDay(hotDates[0]) : today;

  const [hotPages, hotRefs, coldPages, coldRefs] = await Promise.all([
    zsetRange(siteKey, "pages", hotDates),
    zsetRange(siteKey, "refs", hotDates),
    Promise.resolve(sqliteRank("page_daily", sid, coldFrom, coldTo)),
    Promise.resolve(sqliteRank("referrer_daily", sid, coldFrom, coldTo)),
  ]);

  const pages = topN(mergeMaps(coldPages, hotPages), limit);
  // 来源：归一化 direct/"" → 「直接访问」并合并同项，再取 Top
  const refMap: PvMap = new Map();
  mergeMaps(coldRefs, hotRefs).forEach((pv, name) => {
    const n = normRef(name);
    refMap.set(n, (refMap.get(n) ?? 0) + pv);
  });
  const referrers = topN(refMap, limit);
  return { pages, referrers };
}

function prevDay(d: string): string {
  return new Date(new Date(d + "T00:00:00Z").getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
}

/** ---------- 实时访问流 ---------- */

export type FeedItem = { t: number; p: string; r: string; d: string };

export async function feed(siteKey: string): Promise<FeedItem[]> {
  const raw = await redis.lrange(K.feed(siteKey), 0, 19);
  return raw
    .map((line) => {
      try {
        return JSON.parse(line) as FeedItem;
      } catch {
        return null;
      }
    })
    .filter((x): x is FeedItem => x !== null);
}

/** ---------- 跨站点总览（首页大屏） ---------- */

export type SiteRankRow = {
  key: string;
  name: string;
  domain: string;
  today: DayCount;
  total: DayCount;
  trend30: number[]; // 近 30 天 PV 序列（迷你趋势用）
};

export type OverviewData = {
  sites: SiteRankRow[];
  combined: Summary;
  combinedTrend: DayStat[]; // 近 30 天合计
};

/** 全部站点合计 + 域名排名（按今日 PV 降序） */
export async function overview(): Promise<OverviewData> {
  const sites = listSites();
  const rows: SiteRankRow[] = [];
  const sums = {
    today: { pv: 0, uv: 0, ip: 0 },
    yesterday: { pv: 0, uv: 0, ip: 0 },
    total: { pv: 0, uv: 0, ip: 0 },
  };

  for (const s of sites) {
    const [sum, trend] = await Promise.all([summary(s.site_key), dailySeries(s.site_key, 30)]);
    rows.push({
      key: s.site_key,
      name: s.name,
      domain: s.domain,
      today: sum.today,
      total: sum.total,
      trend30: trend.map((d) => d.pv),
    });
    sums.today.pv += sum.today.pv;
    sums.today.uv += sum.today.uv;
    sums.today.ip += sum.today.ip;
    sums.yesterday.pv += sum.yesterday.pv;
    sums.yesterday.uv += sum.yesterday.uv;
    sums.yesterday.ip += sum.yesterday.ip;
    sums.total.pv += sum.total.pv;
    sums.total.uv += sum.total.uv;
    sums.total.ip += sum.total.ip;
  }

  // 合计趋势：按日期对齐相加
  const days = datesBetween(
    dateStr(new Date(Date.now() - 29 * 86400000)),
    dateStr()
  );
  const perSiteTrends = await Promise.all(
    sites.map((s) => dailySeries(s.site_key, 30))
  );
  const combinedTrend: DayStat[] = days.map((d, i) => {
    let pv = 0, uv = 0, ip = 0;
    for (const t of perSiteTrends) {
      pv += t[i]?.pv ?? 0;
      uv += t[i]?.uv ?? 0;
      ip += t[i]?.ip_count ?? 0;
    }
    return { date: d, pv, uv, ip_count: ip };
  });

  // 排名：按今日 PV 降序
  rows.sort((a, b) => b.today.pv - a.today.pv);
  return { sites: rows, combined: sums, combinedTrend };
}
