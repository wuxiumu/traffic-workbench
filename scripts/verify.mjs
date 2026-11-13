#!/usr/bin/env node
/**
 * 端到端冒烟验证（零依赖，对运行中的服务执行）。
 * 用法：BASE=http://127.0.0.1:3000 PASSWORD=admin123 KEY=demo0001 node scripts/verify.mjs
 * 覆盖：健康探针 / 登录 / 采集去重 / 总览一致性。详见 docs/plans/03 V 清单。
 */
const BASE = process.env.BASE || "http://127.0.0.1:3000";
const PASSWORD = process.env.PASSWORD || "admin123";
const KEY = process.env.KEY || "demo0001";

let failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failed++;
};

// 1. 健康探针（含 Redis）
const h = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
ok("health: status=ok & redis=ok & db=ok", !!h && h.status === "ok" && h.redis === "ok" && h.db === "ok",
  h ? `rss=${h.procRssMB}MB` : "接口不可达");

// 2. 未登录 401 + 登录
const unauth = await fetch(`${BASE}/api/stats`);
ok("未登录 /api/stats 返回 401", unauth.status === 401, `实际 ${unauth.status}`);
const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: PASSWORD }),
});
ok("登录成功", login.status === 200);
const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";

// 3. 采集去重：新访客 ×3 → pv+3, uv+1（vid 含时间戳，保证脚本可重复运行）
const vid = `verify-${Date.now()}`;
const before = await fetch(`${BASE}/api/stats?key=${KEY}&days=1`, { headers: { cookie } }).then((r) => r.json());
for (let i = 0; i < 3; i++) {
  await fetch(`${BASE}/api/collect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: KEY, path: `/verify-${Date.now()}`, ref: "", vid, domain: "verify.test" }),
  });
}
const after = await fetch(`${BASE}/api/stats?key=${KEY}&days=1`, { headers: { cookie } }).then((r) => r.json());
const dpv = after.summary.today.pv - before.summary.today.pv;
const duv = after.summary.today.uv - before.summary.today.uv;
ok("采集去重: pv+3 且 uv+1", dpv === 3 && duv === 1, `实际 pv+${dpv} uv+${duv}（同一分钟超过 120 次会触发限流，重跑即可）`);

// 4. 总览一致性：合计 = 各站点之和
const ov = await fetch(`${BASE}/api/overview`, { headers: { cookie } }).then((r) => r.json());
const sumPv = ov.sites.reduce((a, s) => a + s.today.pv, 0);
ok("overview 合计 = 各站点之和", ov.combined.today.pv === sumPv, `${ov.combined.today.pv} vs ${sumPv}`);
ok("overview 站点数 ≥ 1", ov.sites.length >= 1, `${ov.sites.length} 个站点`);

// 5. 归档端点鉴权
const noSecret = await fetch(`${BASE}/api/cron/flush`, { method: "POST" });
ok("未带密钥 /api/cron/flush 被拒", noSecret.status === 401 || noSecret.status === 403, `实际 ${noSecret.status}`);

console.log(failed === 0 ? "\n全部通过 ✅" : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
