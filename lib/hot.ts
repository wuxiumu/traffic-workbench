import { redis, K, WINDOW_TTL } from "@/lib/redis";
import { db, dateStr, now } from "@/lib/db";
import { parseUA } from "@/lib/track";

/**
 * 采集热路径：全部走 Redis pipeline，零 SQLite 写入。
 * SQLite 只在站点缓存未命中时读一次 sites 表。
 */

// 单 IP 每分钟上报上限
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN || "120", 10);
// 单站点单日原始事件在 Redis 中的上限（防内存失控，超出丢最老的）
const EVENTS_CAP = parseInt(process.env.EVENTS_CAP_PER_DAY || "100000", 10);

/** Redis 限流：返回 true = 超限 */
export async function rateLimited(ipHash: string): Promise<boolean> {
  if (!ipHash) return false;
  const minute = new Date().toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm
  const k = K.rate(ipHash, minute);
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, 60);
  return n > RATE_LIMIT;
}

/** 站点缓存：key → "id|domain"，未命中回源 SQLite 并写缓存 */
export async function resolveSite(
  siteKey: string
): Promise<{ id: number; domain: string } | null> {
  const k = K.site(siteKey);
  const cached = await redis.get(k);
  if (cached) {
    const [id, domain] = cached.split("|");
    return { id: Number(id), domain };
  }
  const row = db
    .prepare("SELECT id, domain FROM sites WHERE site_key = ?")
    .get(siteKey) as { id: number; domain: string } | undefined;
  if (!row) return null;
  await redis.setex(k, 300, `${row.id}|${row.domain}`);
  return row;
}

export type HotInput = {
  siteKey: string;
  path: string;
  referrerHost: string;
  visitorId: string;
  ipHash: string;
  ua: string;
};

/** 单条 PV：pipeline 原子批量写 Redis，返回 false = 站点不存在 */
export async function recordHot(input: HotInput): Promise<boolean> {
  const site = await resolveSite(input.siteKey);
  if (!site) return false;

  const date = dateStr();
  const ts = now();
  const { device } = parseUA(input.ua);

  const statsK = K.stats(input.siteKey, date);
  const visK = K.vis(input.siteKey, date);
  const ipsK = K.ips(input.siteKey, date);
  const pagesK = K.pages(input.siteKey, date);
  const refsK = K.refs(input.siteKey, date);
  const eventsK = K.events(input.siteKey, date);
  const feedK = K.feed(input.siteKey);

  // feed 独立于日期窗口，保留 7 天过期即可
  const feedTTL = Math.max(WINDOW_TTL, 7 * 86400);

  const pl = redis.pipeline();
  pl.sadd(visK, input.visitorId);
  if (input.ipHash) pl.sadd(ipsK, input.ipHash);
  pl.hincrby(statsK, "pv", 1);
  pl.zincrby(pagesK, 1, input.path);
  pl.zincrby(refsK, 1, input.referrerHost || "direct");
  pl.rpush(
    eventsK,
    JSON.stringify({
      t: ts,
      p: input.path,
      r: input.referrerHost,
      v: input.visitorId,
      i: input.ipHash,
      u: input.ua.slice(0, 256),
    })
  );
  pl.ltrim(eventsK, -EVENTS_CAP, -1); // 超限丢最老事件
  pl.lpush(
    feedK,
    JSON.stringify({ t: ts, p: input.path, r: input.referrerHost, d: device })
  );
  pl.ltrim(feedK, 0, 49); // 实时流只留最新 50 条
  // 窗口 TTL（幂等，重复设置无害）
  pl.expire(statsK, WINDOW_TTL);
  pl.expire(visK, WINDOW_TTL);
  pl.expire(ipsK, WINDOW_TTL);
  pl.expire(pagesK, WINDOW_TTL);
  pl.expire(refsK, WINDOW_TTL);
  pl.expire(eventsK, WINDOW_TTL);
  pl.expire(feedK, feedTTL);

  const res = await pl.exec();
  if (!res) return true;

  // SADD 返回 1 表示新访客/新 IP → 补计 uv/ip
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
