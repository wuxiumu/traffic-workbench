import { NextRequest, NextResponse } from "next/server";
import { rateLimited } from "@/lib/hot";
import { clientIP, hashIP, normalizeReferrer, sanitizePath } from "@/lib/track";
import { recordUniversal } from "@/lib/universal";

export const dynamic = "force-dynamic";

/**
 * 万能统计采集端点（免 key）：按上报的 domain 自动注册并计入独立大盘。
 * 时效语义：u.js 仅在页面停留 ≥3 秒后发送，不足 3 秒的浏览不会到达本端点。
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function handle(params: URLSearchParams | Record<string, unknown>, req: NextRequest) {
  const get = (k: string) =>
    params instanceof URLSearchParams
      ? params.get(k) ?? ""
      : String((params as Record<string, unknown>)[k] ?? "");

  let domain = get("domain").trim().toLowerCase().slice(0, 128);
  const vid = get("vid").trim().slice(0, 64);
  if (!domain && req.headers.get("referer")) {
    try {
      domain = new URL(req.headers.get("referer")!).hostname;
    } catch {
      domain = "";
    }
  }
  if (!domain || !DOMAIN_RE.test(domain) || !vid) return false;

  const ipHash = hashIP(clientIP(req.headers));
  if (await rateLimited(ipHash || vid)) return false;

  return recordUniversal({
    domain,
    path: sanitizePath(get("path")),
    referrerHost: normalizeReferrer(get("ref"), domain),
    visitorId: vid,
    ipHash,
    ua: req.headers.get("user-agent") ?? "",
  });
}

/** POST JSON 上报（sendBeacon 主通道） */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* 容忍空 body */
  }
  const ok = await handle(body, req);
  return NextResponse.json(
    { ok: ok ? 1 : 0 },
    { status: ok ? 200 : 400, headers: CORS }
  );
}

/** GET 图片像素兜底 */
export async function GET(req: NextRequest) {
  await handle(req.nextUrl.searchParams, req);
  return new NextResponse(GIF, {
    status: 200,
    headers: { ...CORS, "Content-Type": "image/gif", "Cache-Control": "no-store" },
  });
}
