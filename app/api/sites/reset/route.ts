import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";
import { clearSiteData } from "@/lib/clear";

export const dynamic = "force-dynamic";

/** POST /api/sites/reset {keys: string[]} — 多选清空站点统计数据（保留站点配置） */
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { keys?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const keys = (body.keys ?? []).filter((k) => typeof k === "string" && k);
  if (keys.length === 0) {
    return NextResponse.json({ error: "请至少选择一个站点" }, { status: 400 });
  }
  const rows = db
    .prepare(`SELECT id, site_key FROM sites WHERE site_key IN (${keys.map(() => "?").join(",")})`)
    .all(...keys) as { id: number; site_key: string }[];
  for (const r of rows) {
    await clearSiteData(r.site_key, r.id);
  }
  return NextResponse.json({ ok: 1, cleared: rows.length });
}
