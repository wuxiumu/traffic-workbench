import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { feed } from "@/lib/stats";

export const dynamic = "force-dynamic";

/** GET /api/feed?key=xxx — 实时访问流轻量轮询端点 */
export async function GET(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = req.nextUrl.searchParams.get("key") ?? "";
  return NextResponse.json({ feed: await feed(key) });
}
