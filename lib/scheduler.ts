import { redis } from "@/lib/redis";
import { flushOnce } from "@/lib/flush";

/**
 * 每日归档调度器（按需启动，进程内单例）。
 *
 * 为什么不用 instrumentation.ts：Next 14 会把 instrumentation 同时编译进
 * edge bundle，ioredis/better-sqlite3 等 Node 依赖无法豁免（构建失败）。
 * 改由 /api/health（Docker healthcheck 60s 探活 + 监控脚本轮询）与首页
 * 渲染触发 ensureScheduler() —— 容器启动后一分钟内必然拉起，且幂等。
 */

declare global {
  // eslint-disable-next-line no-var
  var __twScheduler: boolean | undefined;
}

export function ensureScheduler(): void {
  if (global.__twScheduler) return;
  global.__twScheduler = true;

  void (async () => {
    try {
      if ((await redis.ping()) !== "PONG") {
        // Redis 未就绪：释放标记，下次探活再试
        global.__twScheduler = false;
        return;
      }
      const cron = (await import("node-cron")).default;
      const expr = process.env.FLUSH_CRON || "0 3 * * *";
      cron.schedule(expr, () => {
        void (async () => {
          try {
            const r = await flushOnce();
            if (r !== "busy") {
              console.log(
                `[flush] archived ${r.archived} events across ${r.days.length} site-days in ${r.durationMs}ms`
              );
            }
          } catch (e) {
            console.error("[flush] failed:", e);
          }
        })();
      });
      console.log(`[flush] cron registered: "${expr}"`);

      // 启动补跑（覆盖停机跨天的窗口数据，幂等安全）
      const r = await flushOnce();
      if (r !== "busy" && r.archived > 0) {
        console.log(`[flush] startup catch-up: archived ${r.archived} events`);
      }
    } catch (e) {
      // 失败允许下次再拉起
      global.__twScheduler = false;
      console.error("[flush] scheduler boot failed:", e instanceof Error ? e.message : e);
    }
  })();
}
