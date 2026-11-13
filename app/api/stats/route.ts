import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { dailySeries, details, feed, listSites, summary } from "@/lib/stats";
import { RETENTION_DAYS } from "@/lib/redis";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats?key=xxx&days=7
 * 一次返回工作台所需全部数据：summary + trend + details + feed（实时动态）
 */
export async function GET(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const daysRaw = parseInt(sp.get("days") ?? "7", 10);
  const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 7;

  const sites = listSites();
  const key = sp.get("key");
  const siteKey = key && sites.some((s) => s.site_key === key)
    ? key
    : (sites[0]?.site_key ?? "");

  const [sum, trend, det, fd] = await Promise.all([
    summary(siteKey),
    dailySeries(siteKey, days),
    details(siteKey, days),
    feed(siteKey),
  ]);

  return NextResponse.json({
    sites: sites.map((s) => ({ key: s.site_key, name: s.name, domain: s.domain })),
    activeKey: siteKey,
    days,
    windowDays: RETENTION_DAYS,
    summary: sum,
    trend,
    details: det,
    feed: fd,
  });
}
