import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { universalBoard } from "@/lib/universal";

export const dynamic = "force-dynamic";

/** GET /api/universal — 万能统计独立大盘（IP 统计 + 域名访问两模块数据） */
export async function GET() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await universalBoard());
}
