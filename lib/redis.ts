import Redis from "ioredis";

/**
 * Redis 热存客户端（单例）。
 * Redis 承载保留窗口期（RETENTION_DAYS，默认 7 天）内的全部实时数据；
 * SQLite 只做历史归档（每日 flush）。
 */

export const RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.RETENTION_DAYS || "7", 10)
);

// 窗口期键 TTL：保留天数 + 2 天缓冲（确保 flush 至少有两次机会归档）
const WINDOW_TTL = (RETENTION_DAYS + 2) * 86400;

declare global {
  // eslint-disable-next-line no-var
  var __twRedis: Redis | undefined;
}

export const redis: Redis =
  global.__twRedis ??
  new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: 2,
    retryStrategy(times) {
      return Math.min(times * 500, 5000);
    },
    lazyConnect: false,
  });

global.__twRedis = redis;

/** ---------- key 构造（集中管理，flush 用 SCAN 匹配 tw:events:*） ---------- */
export const K = {
  site: (key: string) => `tw:site:${key}`, // 站点缓存 key→id|domain
  rate: (ipHash: string, minute: string) => `tw:rl:${ipHash}:${minute}`,
  stats: (key: string, date: string) => `tw:stats:${key}:${date}`, // HASH {pv,uv,ip}
  vis: (key: string, date: string) => `tw:vis:${key}:${date}`, // SET 访客ID
  ips: (key: string, date: string) => `tw:ips:${key}:${date}`, // SET IP哈希
  pages: (key: string, date: string) => `tw:pages:${key}:${date}`, // ZSET path→pv
  refs: (key: string, date: string) => `tw:refs:${key}:${date}`, // ZSET ref→pv
  events: (key: string, date: string) => `tw:events:${key}:${date}`, // LIST 原始事件
  feed: (key: string) => `tw:feed:${key}`, // LIST 最新访问流
};

export { WINDOW_TTL };
