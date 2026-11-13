import { NextRequest, NextResponse } from "next/server";
import { recordHot, rateLimited } from "@/lib/hot";
import { clientIP, hashIP, normalizeReferrer, sanitizePath } from "@/lib/track";

export const dynamic = "force-dynamic";

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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function handle(params: URLSearchParams | Record<string, unknown>, req: NextRequest) {
  const get = (k: string) =>
    params instanceof URLSearchParams
      ? params.get(k) ?? ""
      : String((params as Record<string, unknown>)[k] ?? "");

  const siteKey = get("key").trim();
  const visitorId = get("vid").trim().slice(0, 64);
  if (!siteKey || !visitorId) return false;

  const ipHash = hashIP(clientIP(req.headers));
  if (await rateLimited(ipHash || visitorId)) return false;

  const ua = req.headers.get("user-agent") ?? "";
  const siteDomain = get("domain");

  return recordHot({
    siteKey,
    path: sanitizePath(get("path")),
    referrerHost: normalizeReferrer(get("ref"), siteDomain),
    visitorId,
    ipHash,
    ua,
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

/** GET 图片像素兜底（sendBeacon 不可用时的 <img> 上报） */
export async function GET(req: NextRequest) {
  await handle(req.nextUrl.searchParams, req);
  return new NextResponse(GIF, {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "image/gif",
      "Cache-Control": "no-store",
    },
  });
}
