import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { exportSites } from "@/lib/transfer";

export const dynamic = "force-dynamic";

/** POST /api/export {keys: string[]} — 多选站点数据导出（JSON 下载） */
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
  const payload = await exportSites(keys);
  return new NextResponse(JSON.stringify(payload, null, 1), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="traffic-export-${keys.length}-sites.json"`,
    },
  });
}
