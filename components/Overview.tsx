"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import TrendChart, { TrendPoint } from "./TrendChart";

type DayCount = { pv: number; uv: number; ip: number };
type SiteRankRow = {
  key: string;
  name: string;
  domain: string;
  today: DayCount;
  total: DayCount;
  trend30: number[];
};
type OverviewResponse = {
  sites: SiteRankRow[];
  combined: {
    today: DayCount;
    yesterday: DayCount;
    total: DayCount;
  };
  combinedTrend: TrendPoint[];
  windowDays: number;
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
  total,
  accent,
}: {
  label: string;
  value: number;
  delta: React.ReactNode;
  total: number;
  accent: string;
}) {
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">{label}</span>
        {delta}
      </div>
      <div className={`text-3xl font-bold mt-2 ${accent}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-gray-500 mt-2">
        全部站点累计 {total.toLocaleString()}
      </div>
    </div>
  );
}

/** 近 30 天 PV 迷你趋势（纯 SVG，无依赖） */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  const w = 120;
  const h = 28;
  const step = w / Math.max(1, data.length - 1);
  const pts = data
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export default function Overview() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/overview");
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
    load();
  }, [load]);

  if (error) return <div className="py-32 text-center text-red-400">{error}</div>;
  if (!data) return <div className="py-32 text-center text-gray-500">加载中…</div>;

  const c = data.combined;
  const maxTodayPv = Math.max(...data.sites.map((s) => s.today.pv), 1);

  return (
    <div className="space-y-6">
      {/* 全站合计指标 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="今日 PV（全部域名）"
          value={c.today.pv}
          delta={<Delta now={c.today.pv} prev={c.yesterday.pv} />}
          total={c.total.pv}
          accent="text-blue-400"
        />
        <MetricCard
          label="今日 UV（全部域名）"
          value={c.today.uv}
          delta={<Delta now={c.today.uv} prev={c.yesterday.uv} />}
          total={c.total.uv}
          accent="text-emerald-400"
        />
        <MetricCard
          label="今日 IP（全部域名）"
          value={c.today.ip}
          delta={<Delta now={c.today.ip} prev={c.yesterday.ip} />}
          total={c.total.ip}
          accent="text-amber-400"
        />
      </div>

      {/* 域名排名表 */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-300">域名排名（按今日 PV）</h3>
          <span className="text-xs text-gray-500">点击行进入站点详情</span>
        </div>
        {data.sites.length === 0 ? (
          <p className="text-sm text-gray-600 py-6 text-center">
            还没有站点，先到「站点管理」添加
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                <th className="py-2 pr-2 w-8 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">域名 / 站点</th>
                <th className="py-2 text-right font-medium w-20">今日 PV</th>
                <th className="py-2 text-right font-medium w-20">UV</th>
                <th className="py-2 text-right font-medium w-20">IP</th>
                <th className="py-2 text-right font-medium w-24">30 天累计</th>
                <th className="py-2 pl-4 text-right font-medium w-32">近 30 天趋势</th>
              </tr>
            </thead>
            <tbody>
              {data.sites.map((s, i) => (
                <tr
                  key={s.key}
                  className="border-b border-gray-800/60 last:border-0 hover:bg-gray-800/40 transition-colors cursor-pointer"
                >
                  <td className="py-3 pr-2 text-gray-500">{i + 1}</td>
                  <td className="py-3 pr-2">
                    <Link href={`/site/${s.key}`} className="block">
                      <div className="text-gray-100 font-medium">{s.domain || s.name}</div>
                      <div className="text-xs text-gray-500">{s.name}</div>
                    </Link>
                  </td>
                  <td className="py-3 text-right">
                    <div className="relative h-6 flex items-center justify-end">
                      <div
                        className="absolute inset-y-0 right-0 rounded bg-blue-500/10"
                        style={{ width: `${(s.today.pv / maxTodayPv) * 100}%` }}
                      />
                      <span className="relative text-gray-100">{s.today.pv.toLocaleString()}</span>
                    </div>
                  </td>
                  <td className="py-3 text-right text-gray-300">{s.today.uv.toLocaleString()}</td>
                  <td className="py-3 text-right text-gray-300">{s.today.ip.toLocaleString()}</td>
                  <td className="py-3 text-right text-gray-400">{s.total.pv.toLocaleString()}</td>
                  <td className="py-3 pl-4">
                    <div className="flex justify-end">
                      <Sparkline data={s.trend30} color="#60a5fa" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 合计趋势 */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-300">全站合计趋势（近 30 天）</h3>
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">Redis 实时 {data.windowDays} 天</span>
            +
            <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">SQLite 归档</span>
          </span>
        </div>
        <TrendChart data={data.combinedTrend} />
      </div>
    </div>
  );
}
