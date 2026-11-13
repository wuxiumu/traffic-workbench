import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { importSites, type ExportPayload } from "@/lib/transfer";

export const dynamic = "force-dynamic";

/** POST /api/import — 多选站点数据导入（按日期段替换，幂等） */
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { payload?: ExportPayload; keys?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const keys = (body.keys ?? []).filter((k) => typeof k === "string" && k);
  if (!body.payload || keys.length === 0) {
    return NextResponse.json({ error: "缺少导入数据或未选择站点" }, { status: 400 });
  }
  try {
    const summary = await importSites(body.payload, keys);
    return NextResponse.json({ ok: 1, summary });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "导入失败" },
      { status: 400 }
    );
  }
}
