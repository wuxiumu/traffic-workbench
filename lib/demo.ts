import { redis, K, WINDOW_TTL, RETENTION_DAYS } from "@/lib/redis";
import { db, dateStr } from "@/lib/db";
import { recomputeDay } from "@/lib/flush";
import { clearSiteData } from "@/lib/clear";
import crypto from "crypto";

/**
 * 为指定站点生成 30 天演示数据（先清空再灌，幂等）。
 * 与 scripts/seed.mjs 完全同构：窗口内 → Redis，更早 → SQLite events + 重算聚合。
 * 供「清空数据后灌入 demo」场景（POST /api/demo）。
 */

const PAGES = ["/", "/posts", "/posts/hello-world", "/about", "/archive", "/tags"];
const REFS = ["", "", "", "google.com", "baidu.com", "bing.com", "zhihu.com", "github.com", "weibo.com"];

export async function generateDemoData(siteKey: string, days = 30): Promise<number> {
  const site = db
    .prepare("SELECT id, domain FROM sites WHERE site_key = ?")
    .get(siteKey) as { id: number; domain: string } | undefined;
  if (!site) throw new Error("站点不存在");

  await clearSiteData(siteKey, site.id);

  const dateStrAt = (offset: number) =>
    dateStr(new Date(Date.now() - offset * 86400000));
  const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);

  let total = 0;
  for (let d = days - 1; d >= 0; d--) {
    const date = dateStrAt(d);
    const base = 40 + (days - d) * 1.2;
    const weekend = [0, 6].includes(new Date(date + "T00:00:00Z").getUTCDay()) ? 0.7 : 1;
    const pv = Math.round(base * weekend * (0.8 + Math.random() * 0.5));
    const visitors = Math.max(1, Math.round(pv / (2 + Math.random() * 1.5)));
    const ips = Math.max(1, Math.round(visitors * (0.85 + Math.random() * 0.2)));

    type Ev = { t: number; p: string; r: string; v: string; i: string; u: string };
    const events: Ev[] = [];
    const visSet = new Set<string>(), ipSet = new Set<string>();
    for (let i = 0; i < pv; i++) {
      const vid = `demo-${site.id}-${Math.floor(Math.random() * visitors)}`;
      const ih = hash(`demoip-${site.id}-${Math.floor(Math.random() * ips)}`);
      events.push({
        t: Date.now() - d * 86400000 - Math.floor(Math.random() * 86400000),
        p: PAGES[Math.floor(Math.random() * PAGES.length)],
        r: REFS[Math.floor(Math.random() * REFS.length)],
        v: vid, i: ih,
        u: "Mozilla/5.0 (compatible; DemoBot)",
      });
      visSet.add(vid);
      ipSet.add(ih);
    }
    total += events.length;

    if (d < RETENTION_DAYS) {
      // Redis 窗口路径（与 lib/hot.ts 同构）
      const pl = redis.pipeline();
      for (const e of events) {
        pl.rpush(K.events(siteKey, date), JSON.stringify({
          t: e.t, p: e.p, r: e.r, v: e.v, i: e.i, u: e.u,
        }));
        pl.zincrby(K.pages(siteKey, date), 1, e.p);
        pl.zincrby(K.refs(siteKey, date), 1, e.r || "direct");
      }
      for (const v of visSet) pl.sadd(K.vis(siteKey, date), v);
      for (const h of ipSet) pl.sadd(K.ips(siteKey, date), h);
      pl.hset(K.stats(siteKey, date), { pv: events.length, uv: visSet.size, ip: ipSet.size });
      for (const pre of ["stats", "vis", "ips", "pages", "refs", "events"]) {
        pl.expire(`tw:${pre}:${siteKey}:${date}`, WINDOW_TTL);
      }
      // feed 灌今天的前 20 条
      if (d === 0) {
        for (const e of events.slice(0, 20).reverse()) {
          pl.lpush(K.feed(siteKey), JSON.stringify({ t: e.t, p: e.p, r: e.r, d: "desktop" }));
        }
        pl.ltrim(K.feed(siteKey), 0, 49);
        pl.expire(K.feed(siteKey), Math.max(WINDOW_TTL, 7 * 86400));
      }
      await pl.exec();
    } else {
      // SQLite 归档路径（与 flush 重算同口径）
      const insEvent = db.prepare(
        `INSERT INTO events (site_id, ts, date, path, referrer, visitor_id, ip_hash, ua)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const tx = db.transaction(() => {
        for (const e of events) {
          insEvent.run(site.id, e.t, date, e.p, e.r, e.v, e.i, e.u);
        }
        recomputeDay(site.id, date);
      });
      tx();
    }
  }
  return total;
}
