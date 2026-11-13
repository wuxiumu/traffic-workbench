import crypto from "crypto";
import { cookies } from "next/headers";

/**
 * 极简管理员鉴权：环境变量 ADMIN_PASSWORD + HMAC 签名 Cookie。
 * 单管理员场景够用；Cookie 值 = HMAC-SHA256("admin", password)，
 * 改密码即全员下线。
 */

export const SESSION_COOKIE = "tw_session";

function password(): string {
  return process.env.ADMIN_PASSWORD || "admin123";
}

export function sessionToken(): string {
  return crypto.createHmac("sha256", password()).update("admin").digest("hex");
}

export function checkPassword(input: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(password());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 服务端组件 / API 路由通用校验 */
export function isAuthenticated(): boolean {
  const c = cookies().get(SESSION_COOKIE);
  return !!c && c.value === sessionToken();
}
