import { NextRequest, NextResponse } from "next/server";
import { flushOnce } from "@/lib/flush";

export const dynamic = "force-dynamic";

/**
 * 手动触发归档（补跑/巡检用）。
 * 每天 03:00 由应用内 cron 自动执行（instrumentation.ts）。
 * 鉴权：X-Cron-Secret 头 === CRON_SECRET 环境变量；未配置 CRON_SECRET 时拒绝。
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "未配置 CRON_SECRET，端点禁用" }, { status: 403 });
  }
  if (req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await flushOnce();
  if (r === "busy") {
    return NextResponse.json({ ok: 0, error: "归档进行中，请稍后" }, { status: 409 });
  }
  return NextResponse.json({ ok: 1, ...r });
}
