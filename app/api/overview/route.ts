import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { overview } from "@/lib/stats";
import { RETENTION_DAYS } from "@/lib/redis";

export const dynamic = "force-dynamic";

/** GET /api/overview — 首页大屏：全站合计 + 域名排名 + 合计趋势（近 30 天） */
export async function GET() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const data = await overview();
  return NextResponse.json({ ...data, windowDays: RETENTION_DAYS });
}
