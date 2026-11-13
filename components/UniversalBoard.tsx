"use client";

import { useCallback, useEffect, useState } from "react";
import TrendChart, { TrendPoint } from "./TrendChart";

type UDayCount = { pv: number; uv: number; ip: number };
type UDomainRow = {
  domain: string;
  firstSeen: number;
  today: UDayCount;
  yesterday: UDayCount;
  windowSum: UDayCount;
};
type UniversalResponse = {
  domains: UDomainRow[];
  totals: { today: UDayCount; yesterday: UDayCount };
  series: TrendPoint[];
  windowDays: number;
  autoRegistered: number;
};

function Delta({ now, prev }: { now: number; prev: number }) {
  if (prev === 0 && now === 0) return <span className="text-gray-500 text-xs">—</span>;
  const pct = prev === 0 ? 100 : Math.round(((now - prev) / prev) * 100);
  const up = pct >= 0;
  return (
    <span className={`text-xs font-medium ${up ? "text-emerald-400" : "text-red-400"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

function MetricCard({
  label,
  value,
  delta,
  accent,
}: {
  label: string;
  value: number;
  delta?: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">{label}</span>
        {delta}
      </div>
      <div className={`text-3xl font-bold mt-2 ${accent}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        copied ? "bg-emerald-600 text-white" : "bg-gray-700 text-gray-200 hover:bg-gray-600"
      }`}
    >
      {copied ? "已复制 ✓" : "复制"}
    </button>
  );
}

export default function UniversalBoard() {
  const [data, setData] = useState<UniversalResponse | null>(null);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");
  const [tab, setTab] = useState<"domains" | "ips">("domains");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/universal");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      setData(await res.json());
      setError("");
    } catch {
      setError("加载失败，请稍后重试");
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    load();
    const timer = setInterval(load, 30000); // 30s 自动刷新
    return () => clearInterval(timer);
  }, [load]);

  if (error) return <div className="py-32 text-center text-red-400">{error}</div>;
  if (!data) return <div className="py-32 text-center text-gray-500">加载中…</div>;

  const t = data.totals;
  const snippet = `<script async src="${origin}/u.js"></script>`;
  const maxPv = Math.max(...data.domains.map((d) => d.today.pv), 1);
  const maxIp = Math.max(...data.domains.map((d) => d.today.ip), 1);

  return (
    <div className="space-y-6">
      {/* 说明 + 接入代码 */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold mb-1">🌐 万能统计</h2>
            <p className="text-sm text-gray-400 max-w-2xl leading-relaxed">
              把下面的代码放进<strong className="text-gray-200">任何网站</strong>的{" "}
              <code>&lt;head&gt;</code>，无需注册站点，后台按域名自动统计。
              <span className="text-amber-300 ml-1">
                规则：页面停留满 3 秒才计入 PV/UV/IP，快速跳转或秒关不计（防误报）。
              </span>
            </p>
          </div>
          <div className="flex items-start gap-2 min-w-[320px]">
            <pre className="flex-1 overflow-x-auto rounded-lg bg-gray-950 border border-gray-800 p-3 text-xs text-emerald-300">
              {snippet}
            </pre>
            <CopyButton text={snippet} />
          </div>
        </div>
      </div>

      {/* 指标卡 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="接入域名数" value={data.autoRegistered} accent="text-purple-400" />
        <MetricCard
          label="今日 PV（全部域名）"
          value={t.today.pv}
          delta={<Delta now={t.today.pv} prev={t.yesterday.pv} />}
          accent="text-blue-400"
        />
        <MetricCard
          label="今日 UV（全部域名）"
          value={t.today.uv}
          delta={<Delta now={t.today.uv} prev={t.yesterday.uv} />}
          accent="text-emerald-400"
        />
        <MetricCard
          label="今日 IP（全部域名）"
          value={t.today.ip}
          delta={<Delta now={t.today.ip} prev={t.yesterday.ip} />}
          accent="text-amber-400"
        />
      </div>

      {/* 趋势 */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">
          全部域名趋势（近 14 天）
        </h3>
        <TrendChart data={data.series} />
      </div>

      {/* 两模块表 */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setTab("domains")}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              tab === "domains"
                ? "bg-blue-600 text-white"
                : "bg-gray-900 border border-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            域名访问
          </button>
          <button
            onClick={() => setTab("ips")}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              tab === "ips"
                ? "bg-blue-600 text-white"
                : "bg-gray-900 border border-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            IP 统计
          </button>
          <span className="text-xs text-gray-500 ml-auto">30s 自动刷新</span>
        </div>

        {data.domains.length === 0 ? (
          <p className="text-sm text-gray-600 py-8 text-center">
            还没有域名接入 — 把上方代码放进任意网站，访问后这里会自动出现
          </p>
        ) : tab === "domains" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                <th className="py-2 pr-2 w-8 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">域名</th>
                <th className="py-2 text-right font-medium w-24">今日 PV</th>
                <th className="py-2 text-right font-medium w-16">UV</th>
                <th className="py-2 text-right font-medium w-24">昨日 PV</th>
                <th className="py-2 text-right font-medium w-20">环比</th>
                <th className="py-2 text-right font-medium w-28">近 {data.windowDays} 天 PV</th>
              </tr>
            </thead>
            <tbody>
              {data.domains.map((d, i) => (
                <tr key={d.domain} className="border-b border-gray-800/60 last:border-0">
                  <td className="py-3 pr-2 text-gray-500">{i + 1}</td>
                  <td className="py-3 pr-2">
                    <div className="relative">
                      <div
                        className="absolute inset-y-0 left-0 rounded bg-blue-500/10"
                        style={{ width: `${(d.today.pv / maxPv) * 100}%` }}
                      />
                      <span className="relative text-gray-100 font-medium">{d.domain}</span>
                    </div>
                  </td>
                  <td className="py-3 text-right text-gray-100">{d.today.pv.toLocaleString()}</td>
                  <td className="py-3 text-right text-gray-300">{d.today.uv.toLocaleString()}</td>
                  <td className="py-3 text-right text-gray-400">{d.yesterday.pv.toLocaleString()}</td>
                  <td className="py-3 text-right">
                    <Delta now={d.today.pv} prev={d.yesterday.pv} />
                  </td>
                  <td className="py-3 text-right text-gray-400">
                    {d.windowSum.pv.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                <th className="py-2 pr-2 w-8 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">域名</th>
                <th className="py-2 text-right font-medium w-24">今日独立 IP</th>
                <th className="py-2 text-right font-medium w-24">昨日独立 IP</th>
                <th className="py-2 text-right font-medium w-20">环比</th>
                <th className="py-2 text-right font-medium w-28">近 {data.windowDays} 天 IP 合计</th>
              </tr>
            </thead>
            <tbody>
              {[...data.domains]
                .sort((a, b) => b.today.ip - a.today.ip)
                .map((d, i) => (
                  <tr key={d.domain} className="border-b border-gray-800/60 last:border-0">
                    <td className="py-3 pr-2 text-gray-500">{i + 1}</td>
                    <td className="py-3 pr-2">
                      <div className="relative">
                        <div
                          className="absolute inset-y-0 left-0 rounded bg-amber-500/10"
                          style={{ width: `${(d.today.ip / maxIp) * 100}%` }}
                        />
                        <span className="relative text-gray-100 font-medium">{d.domain}</span>
                      </div>
                    </td>
                    <td className="py-3 text-right text-amber-300 font-medium">
                      {d.today.ip.toLocaleString()}
                    </td>
                    <td className="py-3 text-right text-gray-400">{d.yesterday.ip.toLocaleString()}</td>
                    <td className="py-3 text-right">
                      <Delta now={d.today.ip} prev={d.yesterday.ip} />
                    </td>
                    <td className="py-3 text-right text-gray-400">
                      {d.windowSum.ip.toLocaleString()}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-gray-600 mt-3">
          IP 为按日去重后的独立 IP 数（哈希脱敏存储，不可还原明文）；近 N 天为各日去重数合计。
        </p>
      </div>
    </div>
  );
}
