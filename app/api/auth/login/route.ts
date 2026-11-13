import { NextRequest, NextResponse } from "next/server";
import { checkPassword, SESSION_COOKIE, sessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!checkPassword(body.password ?? "")) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: 1 });
  res.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 天
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
