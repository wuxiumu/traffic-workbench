import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { generateDemoData } from "@/lib/demo";

export const dynamic = "force-dynamic";

/** POST /api/demo {keys: string[]} — 为所选站点灌 30 天演示数据（先清空再生成，幂等） */
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
  const results: { key: string; events: number }[] = [];
  for (const k of keys) {
    try {
      results.push({ key: k, events: await generateDemoData(k) });
    } catch (e) {
      return NextResponse.json(
        { error: `站点 ${k}: ${e instanceof Error ? e.message : "生成失败"}` },
        { status: 400 }
      );
    }
  }
  return NextResponse.json({ ok: 1, results });
}
