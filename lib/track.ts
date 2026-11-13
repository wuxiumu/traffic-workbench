import crypto from "crypto";

/** ---------- UA 解析（轻量正则版，不引第三方库） ---------- */

export type UAInfo = {
  browser: string;
  os: string;
  device: "desktop" | "mobile" | "tablet" | "other";
};

const BROWSER_RULES: [string, RegExp][] = [
  ["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/],
  ["Firefox", /Firefox|FxiOS\/([\d.]+)/],
  ["Opera", /OPR\/([\d.]+)|Opera/],
  ["QQ浏览器", /QQBrowser\/([\d.]+)/],
  ["UC浏览器", /UCBrowser\/([\d.]+)/],
  ["微信内置", /MicroMessenger\/([\d.]+)/],
  ["Safari", /Version\/([\d.]+).*Safari/],
  ["Chrome", /Chrome|CriOS\/([\d.]+)/],
  ["IE", /MSIE [\d.]+|Trident\/[\d.]+/],
];

const OS_RULES: [string, RegExp][] = [
  ["Windows", /Windows NT/],
  ["macOS", /Mac OS X/],
  ["Android", /Android/],
  ["iOS", /iPhone|iPad|iPod/],
  ["HarmonyOS", /HarmonyOS/],
  ["Linux", /Linux/],
];

export function parseUA(ua: string): UAInfo {
  let browser = "其他";
  for (const [name, re] of BROWSER_RULES) {
    if (re.test(ua)) {
      browser = name;
      break;
    }
  }
  let os = "其他";
  for (const [name, re] of OS_RULES) {
    if (re.test(ua)) {
      os = name;
      break;
    }
  }
  let device: UAInfo["device"] = "desktop";
  if (/iPad|Tablet/i.test(ua)) device = "tablet";
  else if (/Mobile|iPhone|Android/i.test(ua)) device = "mobile";
  return { browser, os, device };
}

/** ---------- Referer 归一化与来源归类 ---------- */

// 主流搜索引擎域名 → 展示名
const SEARCH_ENGINES: Record<string, string> = {
  "google.com": "Google",
  "bing.com": "Bing",
  "baidu.com": "百度",
  "sogou.com": "搜狗",
  "so.com": "360搜索",
  "sm.cn": "神马搜索",
  "duckduckgo.com": "DuckDuckGo",
  "yandex.com": "Yandex",
};

const SOCIAL_HOSTS: Record<string, string> = {
  "weibo.com": "微博", "weibo.cn": "微博", "m.weibo.cn": "微博", "t.cn": "微博",
  "zhihu.com": "知乎", "link.zhihu.com": "知乎",
  "xiaohongshu.com": "小红书",
  "douyin.com": "抖音", "v.douyin.com": "抖音",
  "bilibili.com": "B站", "b23.tv": "B站",
  "tieba.baidu.com": "贴吧",
  "twitter.com": "Twitter", "x.com": "Twitter", "t.co": "Twitter",
  "facebook.com": "Facebook", "t.me": "Telegram",
  "juejin.cn": "掘金", "csdn.net": "CSDN",
  "github.com": "GitHub", "stackoverflow.com": "StackOverflow",
};

/** 提取 referer 的 host（无 referer / 同站 → ''） */
export function normalizeReferrer(referrer: string, siteDomain: string): string {
  if (!referrer) return "";
  let host = "";
  try {
    const u = new URL(referrer);
    host = u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
  const domain = siteDomain.replace(/^www\./, "");
  // 站内跳转不算外部来源
  if (domain && (host === domain || host.endsWith("." + domain))) return "";
  return host;
}

/** 来源展示归类：搜索引擎 / 社媒 / 直接访问 / 外链域名 */
export function classifyReferrer(refHost: string): string {
  if (!refHost) return "直接访问";
  for (const [d, name] of Object.entries(SEARCH_ENGINES)) {
    if (refHost === d || refHost.endsWith("." + d)) return name;
  }
  for (const [d, name] of Object.entries(SOCIAL_HOSTS)) {
    if (refHost === d || refHost.endsWith("." + d)) return name;
  }
  return refHost;
}

/** 路径清洗与截断（collect / u 两个采集端点共用） */
export function sanitizePath(p: string): string {
  if (!p || typeof p !== "string") return "/";
  try {
    const u = new URL(p, "https://x.local");
    return (u.pathname + u.search).slice(0, 512) || "/";
  } catch {
    return p.slice(0, 512);
  }
}

/** ---------- IP 提取与脱敏 ---------- */

/** 从请求头取客户端真实 IP（Nginx 反代后靠 X-Forwarded-For） */
export function clientIP(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") || "";
}

let ipSalt: string | null = null;
function getSalt(): string {
  if (!ipSalt) {
    ipSalt = process.env.IP_SALT || "tw-default-salt";
  }
  return ipSalt;
}

/** IP 只存 sha256 哈希，日志与库中不留明文 */
export function hashIP(ip: string): string {
  if (!ip) return "";
  return crypto.createHash("sha256").update(ip + getSalt()).digest("hex").slice(0, 32);
}
