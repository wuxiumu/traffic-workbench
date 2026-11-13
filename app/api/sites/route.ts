import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";
import { clearSiteRedis } from "@/lib/clear";

export const dynamic = "force-dynamic";

function newKey(): string {
  return crypto.randomBytes(8).toString("hex");
}

export async function GET() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sites = db
    .prepare("SELECT id, name, domain, site_key, created_at FROM sites ORDER BY id DESC")
    .all();
  return NextResponse.json({ sites });
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { name?: string; domain?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const name = (body.name ?? "").trim().slice(0, 64);
  const domain = (body.domain ?? "").trim().toLowerCase().slice(0, 128);
  if (!name) {
    return NextResponse.json({ error: "站点名称不能为空" }, { status: 400 });
  }
  const key = newKey();
  db.prepare("INSERT INTO sites (name, domain, site_key, created_at) VALUES (?, ?, ?, ?)")
    .run(name, domain, key, Date.now());
  return NextResponse.json({ ok: 1, siteKey: key, name, domain });
}

export async function DELETE(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const row = db.prepare("SELECT id FROM sites WHERE site_key = ?").get(key) as
    | { id: number }
    | undefined;
  if (!row) return NextResponse.json({ error: "站点不存在" }, { status: 404 });
  // 清统计四表
  const tx = db.transaction(() => {
    for (const t of ["events", "daily_stats", "page_daily", "referrer_daily"]) {
      db.prepare(`DELETE FROM ${t} WHERE site_id = ?`).run(row.id);
    }
  });
  tx();
  db.prepare("DELETE FROM sites WHERE id = ?").run(row.id);
  // 清 Redis 侧：站点缓存 + 全部窗口键 + feed
  await clearSiteRedis(key);
  return NextResponse.json({ ok: 1 });
}
