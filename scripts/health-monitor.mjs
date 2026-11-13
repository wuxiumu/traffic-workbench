#!/usr/bin/env node
/**
 * 健康监控脚本（零依赖，Node 18+）
 *
 * 用法：
 *   node scripts/health-monitor.mjs                     # 单次检查，异常时才发通知
 *   node scripts/health-monitor.mjs --loop              # 常驻循环（默认 60s 间隔）
 *
 * 配置（环境变量）：
 *   HEALTH_URL      健康检查地址，默认 http://127.0.0.1:3000/api/health
 *   WEBHOOK_URL     通知 webhook（支持飞书/钉钉/企业微信通用格式，POST {msg_type|msgtype, content|text}）
 *                   Server酱：WEBHOOK_URL=https://sctapi.ftqq.com/SENDKEY.send
 *   CHECK_INTERVAL  --loop 模式检查间隔秒数，默认 60
 *   DISK_MAX_PCT    磁盘使用率告警阈值，默认 85
 *   MEM_FREE_MIN_GB 系统可用内存告警阈值（GB），默认 1
 *
 * 通知策略：只在状态变化时发（异常→恢复 也会发一条），避免刷屏。
 * 推荐配合 crontab 每 5 分钟跑一次单次模式（见 README）。
 */
import os from "os";

const HEALTH_URL = process.env.HEALTH_URL || "http://127.0.0.1:3000/api/health";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const INTERVAL = parseInt(process.env.CHECK_INTERVAL || "60", 10) * 1000;
const DISK_MAX_PCT = parseFloat(process.env.DISK_MAX_PCT || "85");
const MEM_FREE_MIN_GB = parseFloat(process.env.MEM_FREE_MIN_GB || "1");
const LOOP = process.argv.includes("--loop");

const stateFile = new URL("../data/.monitor-state.json", import.meta.url);
let lastState = "unknown"; // ok | error | unknown

async function notify(title, text) {
  if (!WEBHOOK_URL) {
    console.log(`[notify-skipped] ${title}: ${text}`);
    return;
  }
  const isServerChan = WEBHOOK_URL.includes("sctapi.ftqq.com");
  const isFeishu = WEBHOOK_URL.includes("feishu") || WEBHOOK_URL.includes("open.feishu.cn");
  const body = isServerChan
    ? { title, desp: text }
    : isFeishu
      ? { msg_type: "text", content: { text: `${title}\n${text}` } }
      : { msgtype: "text", text: { content: `${title}\n${text}` } };
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error("[notify-failed]", e.message);
  }
}

async function checkOnce() {
  const problems = [];

  // 1. 应用健康接口
  let health = null;
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(10000) });
    health = await res.json();
    if (!res.ok || health.status !== "ok" || health.db !== "ok") {
      problems.push(`应用异常: HTTP ${res.status}, db=${health?.db ?? "?"}`);
    }
  } catch (e) {
    problems.push(`健康接口不可达: ${e.message}`);
  }

  // 2. 系统内存
  const freeGB = os.freemem() / 1024 ** 3;
  if (freeGB < MEM_FREE_MIN_GB) {
    problems.push(`系统可用内存不足: ${freeGB.toFixed(2)} GB < ${MEM_FREE_MIN_GB} GB`);
  }

  // 3. 负载
  const cores = os.cpus().length;
  const load1 = os.loadavg()[0];
  if (load1 > cores * 2) {
    problems.push(`负载过高: load1=${load1.toFixed(2)} > ${cores}核×2`);
  }

  // 4. 磁盘（仅 Linux/macOS，Docker 容器内也可用）
  try {
    const { statfsSync } = await import("fs");
    const st = statfsSync(process.env.DATA_DIR || ".");
    const total = Number(st.blocks) * Number(st.bsize);
    const free = Number(st.bavail) * Number(st.bsize);
    const usedPct = ((total - free) / total) * 100;
    if (usedPct > DISK_MAX_PCT) {
      problems.push(`磁盘使用率过高: ${usedPct.toFixed(1)}% > ${DISK_MAX_PCT}%`);
    }
  } catch {
    /* statfs 不可用时跳过 */
  }

  const curState = problems.length === 0 ? "ok" : "error";
  const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  if (curState !== lastState) {
    if (curState === "ok") {
      await notify("✅ 服务恢复", `流量统计工作台已恢复正常\n时间: ${now}`);
    } else {
      await notify("🚨 服务异常", `${problems.join("\n")}\n时间: ${now}\n健康数据: ${JSON.stringify(health ?? null)}`);
    }
    lastState = curState;
    try {
      const fs = await import("fs");
      fs.writeFileSync(stateFile, JSON.stringify({ state: lastState, ts: now }));
    } catch {}
  }

  console.log(`[${now}] state=${curState}${problems.length ? " | " + problems.join("; ") : ""}`);
  return curState;
}

if (LOOP) {
  console.log(`监控启动: ${HEALTH_URL}，每 ${INTERVAL / 1000}s 检查一次`);
  const run = async () => {
    try {
      await checkOnce();
    } catch (e) {
      console.error("[check-failed]", e);
    }
  };
  await run();
  setInterval(run, INTERVAL);
} else {
  await checkOnce();
  process.exit(0);
}
