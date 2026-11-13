import { redis } from "@/lib/redis";
import { db } from "@/lib/db";

/**
 * 站点数据清空（保留站点配置）：SQLite 统计表 + Redis 窗口键 + 实时流。
 * 站点删除（DELETE /api/sites）与数据重置（POST /api/sites/reset）共用。
 */
export function clearSiteSQLite(siteId: number): void {
  const tx = db.transaction(() => {
    for (const t of ["events", "daily_stats", "page_daily", "referrer_daily"]) {
      db.prepare(`DELETE FROM ${t} WHERE site_id = ?`).run(siteId);
    }
  });
  tx();
}

/** Redis 侧：窗口键（stats/vis/ips/pages/refs/events）+ feed + 站点缓存 */
export async function clearSiteRedis(siteKey: string): Promise<void> {
  await redis.del(`tw:site:${siteKey}`, `tw:feed:${siteKey}`);
  const prefixes = ["stats", "vis", "ips", "pages", "refs", "events"];
  for (const p of prefixes) {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `tw:${p}:${siteKey}:*`, "COUNT", 200);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  }
}

/** 全量清空（SQLite + Redis） */
export async function clearSiteData(siteKey: string, siteId: number): Promise<void> {
  clearSiteSQLite(siteId);
  await clearSiteRedis(siteKey);
}
