import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { ensureScheduler } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — 健康检查探针（health-monitor / Docker healthcheck / 反代探活）
 * 探测：DB 读写 + Redis ping + 进程内存 + 系统内存/负载；不做鉴权。
 */
export async function GET() {
  ensureScheduler(); // 探活即拉起归档调度器（幂等）
  let dbOk = true;
  try {
    db.prepare("SELECT 1").get();
  } catch {
    dbOk = false;
  }

  let redisOk = false;
  try {
    redisOk = (await redis.ping()) === "PONG";
  } catch {
    redisOk = false;
  }

  const ok = dbOk && redisOk;
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  let disk: { totalGB: number; freeGB: number; usedPct: number } | null = null;
  try {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const st = fs.statfsSync(dataDir);
    const total = Number(st.blocks) * Number(st.bsize);
    const free = Number(st.bavail) * Number(st.bsize);
    disk = {
      totalGB: +(total / 1024 ** 3).toFixed(1),
      freeGB: +(free / 1024 ** 3).toFixed(1),
      usedPct: +(((total - free) / total) * 100).toFixed(1),
    };
  } catch {
    disk = null;
  }

  const body = {
    status: ok ? "ok" : "error",
    uptimeSec: Math.round(process.uptime()),
    db: dbOk ? "ok" : "error",
    redis: redisOk ? "ok" : "error",
    procRssMB: +(mem.rss / 1024 ** 2).toFixed(1),
    sys: {
      freeMemGB: +(freeMem / 1024 ** 3).toFixed(1),
      totalMemGB: +(totalMem / 1024 ** 3).toFixed(1),
      load1: +(os.loadavg()[0]).toFixed(2),
    },
    disk,
    ts: Date.now(),
  };

  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
