import { redis, K_U, WINDOW_TTL, RETENTION_DAYS } from "@/lib/redis";
import { db, dateStr, now } from "@/lib/db";
import { parseUA } from "@/lib/track";

/**
 * 万能统计（免 key）：按域名自动注册 + 独立命名空间 K_U 的热路径与大盘查询。
 * 与 keyed 站点（tw:*）完全隔离；默认大盘不受影响。
 */

// 单域名单日事件在 Redis 中的上限（与 keyed 侧同策略）
const EVENTS_CAP = parseInt(process.env.EVENTS_CAP_PER_DAY || "100000", 10);

const DEVICE_LABEL: Record<string, string> = {
  desktop: "桌面", mobile: "移动", tablet: "平板", other: "桌面",
};

/** 自动注册：缓存未命中才写一次 SQLite（INSERT OR IGNORE 幂等） */
async function ensureDomain(domain: string): Promise<void> {
  const ck = K_U.site(domain);
  if (await redis.get(ck)) return;
  db.prepare("INSERT OR IGNORE INTO u_sites (domain, first_seen) VALUES (?, ?)").run(
    domain,
    now()
  );
  await redis.setex(ck, 300, "1");
}

export type UInput = {
  domain: string;
  path: string;
  referrerHost: string;
  visitorId: string;
  ipHash: string;
  ua: string;
};

/** 万能采集热路径：纯 Redis pipeline，SADD 返回值驱动 uv/ip 计数 */
export async function recordUniversal(input: UInput): Promise<boolean> {
  await ensureDomain(input.domain);

  const date = dateStr();
  const ts = now();
  const { device } = parseUA(input.ua);

  const statsK = K_U.stats(input.domain, date);
  const visK = K_U.vis(input.domain, date);
  const ipsK = K_U.ips(input.domain, date);
  const eventsK = K_U.events(input.domain, date);

  const pl = redis.pipeline();
  pl.sadd(visK, input.visitorId);
  if (input.ipHash) pl.sadd(ipsK, input.ipHash);
  pl.hincrby(statsK, "pv", 1);
  pl.rpush(
    eventsK,
    JSON.stringify({
      t: ts,
      p: input.path,
      r: input.referrerHost,
      v: input.visitorId,
      i: input.ipHash,
      d: device,
    })
  );
  pl.ltrim(eventsK, -EVENTS_CAP, -1);
  pl.expire(statsK, WINDOW_TTL);
  pl.expire(visK, WINDOW_TTL);
  pl.expire(ipsK, WINDOW_TTL);
  pl.expire(eventsK, WINDOW_TTL);

  const res = await pl.exec();
  if (!res) return true;
  const newVisitor = (res[0][1] as number) === 1;
  const newIP = input.ipHash ? ((res[1]?.[1] as number) ?? 0) === 1 : false;
  if (newVisitor || newIP) {
    const pl2 = redis.pipeline();
    if (newVisitor) pl2.hincrby(statsK, "uv", 1);
    if (newIP) pl2.hincrby(statsK, "ip", 1);
    await pl2.exec();
  }
  return true;
}

/** ---------- 独立大盘查询（混合：窗口 Redis / 更早 SQLite） ---------- */

export type UDayCount = { pv: number; uv: number; ip: number };
const ZERO: UDayCount = { pv: 0, uv: 0, ip: 0 };

function windowStart(): string {
  return dateStr(new Date(Date.now() - (RETENTION_DAYS - 1) * 86400000));
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const t = new Date(to + "T00:00:00Z").getTime();
  for (let ts = new Date(from + "T00:00:00Z").getTime(); ts <= t; ts += 86400000) {
    out.push(new Date(ts).toISOString().slice(0, 10));
  }
  return out;
}

function sqliteUDay(domain: string, date: string): UDayCount {
  const r = db
    .prepare("SELECT pv, uv, ip_count FROM u_daily WHERE domain = ? AND date = ?")
    .get(domain, date) as { pv: number; uv: number; ip_count: number } | undefined;
  return r ? { pv: r.pv, uv: r.uv, ip: r.ip_count } : ZERO;
}

async function redisUDay(domain: string, date: string): Promise<UDayCount> {
  const r = (await redis.hgetall(K_U.stats(domain, date))) as Record<string, string>;
  return { pv: Number(r.pv ?? 0), uv: Number(r.uv ?? 0), ip: Number(r.ip ?? 0) };
}

/** 单日单域名计数（自动选源） */
async function uDay(domain: string, date: string): Promise<UDayCount> {
  return date >= windowStart()
    ? redisUDay(domain, date)
    : sqliteUDay(domain, date);
}

export type UDomainRow = {
  domain: string;
  firstSeen: number;
  today: UDayCount;
  yesterday: UDayCount;
  windowSum: UDayCount; // 保留窗口期合计（默认 7 天）
};

export type UniversalBoard = {
  domains: UDomainRow[];
  totals: { today: UDayCount; yesterday: UDayCount };
  series: { date: string; pv: number; uv: number; ip_count: number }[]; // 近 14 天合计
  windowDays: number;
  autoRegistered: number;
};

/** 独立大盘：全部自动注册域名的访问/IP 两模块数据 */
export async function universalBoard(): Promise<UniversalBoard> {
  const rows = db
    .prepare("SELECT domain, first_seen FROM u_sites ORDER BY first_seen")
    .all() as { domain: string; first_seen: number }[];
  const today = dateStr();
  const yesterday = dateStr(new Date(Date.now() - 86400000));
  const ws = windowStart();

  // 窗口期合计（近 RETENTION_DAYS 天，含今日）
  const winDates = datesBetween(ws, today);

  const domains: UDomainRow[] = [];
  for (const { domain, first_seen } of rows) {
    const [t, y] = await Promise.all([uDay(domain, today), uDay(domain, yesterday)]);
    let winSum: UDayCount = { pv: 0, uv: 0, ip: 0 };
    if (today >= ws && winDates.length > 1) {
      // 窗口内逐日（窗口日期全走 Redis）
      const pl = redis.pipeline();
      for (const d of winDates) pl.hgetall(K_U.stats(domain, d));
      const res = await pl.exec();
      for (let i = 0; i < winDates.length; i++) {
        const r = (res![i][1] as Record<string, string>) ?? {};
        winSum.pv += Number(r.pv ?? 0);
        winSum.uv += Number(r.uv ?? 0);
        winSum.ip += Number(r.ip ?? 0);
      }
    } else {
      // 窗口不可用（RETENTION=1 等）走 SQLite 求和
      const r = db
        .prepare(
          "SELECT COALESCE(SUM(pv),0) pv, COALESCE(SUM(uv),0) uv, COALESCE(SUM(ip_count),0) ip FROM u_daily WHERE domain = ? AND date >= ? AND date <= ?"
        )
        .get(domain, ws, today) as { pv: number; uv: number; ip: number };
      winSum = { pv: r.pv, uv: r.uv, ip: r.ip };
    }
    domains.push({
      domain,
      firstSeen: first_seen,
      today: t,
      yesterday: y,
      windowSum: winSum,
    });
  }

  // 近 14 天合计序列（跨域名相加，逐日选源）
  const days14 = datesBetween(
    dateStr(new Date(Date.now() - 13 * 86400000)),
    today
  );
  const series = [] as UniversalBoard["series"];
  for (const d of days14) {
    let pv = 0, uv = 0, ip = 0;
    for (const { domain } of rows) {
      const c = await uDay(domain, d);
      pv += c.pv;
      uv += c.uv;
      ip += c.ip;
    }
    series.push({ date: d, pv, uv, ip_count: ip });
  }

  const totals = domains.reduce(
    (acc, d) => {
      acc.today.pv += d.today.pv;
      acc.today.uv += d.today.uv;
      acc.today.ip += d.today.ip;
      acc.yesterday.pv += d.yesterday.pv;
      acc.yesterday.uv += d.yesterday.uv;
      acc.yesterday.ip += d.yesterday.ip;
      return acc;
    },
    { today: { ...ZERO }, yesterday: { ...ZERO } }
  );

  return {
    domains: domains.sort((a, b) => b.today.pv - a.today.pv),
    totals,
    series,
    windowDays: RETENTION_DAYS,
    autoRegistered: rows.length,
  };
}

export { DEVICE_LABEL };
