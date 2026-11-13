"use client";

import { useCallback, useEffect, useState } from "react";
import TrendChart, { TrendPoint } from "./TrendChart";

type Summary = {
  today: { pv: number; uv: number; ip: number };
  yesterday: { pv: number; uv: number; ip: number };
  total: { pv: number; uv: number; ip: number };
};
type RankRow = { name: string; pv: number };
type FeedItem = { t: number; p: string; r: string; d: string };
type StatsResponse = {
  sites: { key: string; name: string; domain: string }[];
  activeKey: string;
  days: number;
  windowDays: number;
  summary: Summary;
  trend: TrendPoint[];
  details: { pages: RankRow[]; referrers: RankRow[] };
  feed: FeedItem[];
};

const DAYS_OPTIONS = [7, 30, 90];
const DEVICE_LABEL: Record<string, string> = {
  desktop: "🖥 桌面",
  mobile: "📱 移动",
  tablet: "📟 平板",
  other: "🖥 桌面",
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
        全站累计 {total.toLocaleString()}
      </div>
    </div>
  );
}

function RankTable({ title, rows }: { title: string; rows: RankRow[] }) {
  const max = rows[0]?.pv ?? 1;
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-4">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">暂无数据</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name + i} className="border-b border-gray-800/60 last:border-0">
                <td className="py-2 pr-2 w-6 text-gray-500">{i + 1}</td>
                <td className="py-2 pr-2">
                  <div className="relative">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-blue-500/10"
                      style={{ width: `${(r.pv / max) * 100}%` }}
                    />
                    <span className="relative truncate block max-w-[240px] text-gray-200">
                      {r.name || "直接访问"}
                    </span>
                  </div>
                </td>
                <td className="py-2 text-right text-gray-300 w-16">{r.pv.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

function LiveFeed({ siteKey, initial }: { siteKey: string; initial: FeedItem[] }) {
  const [items, setItems] = useState<FeedItem[]>(initial);

  const load = useCallback(async () => {
    try {
      // 轻量轮询：单独端点太重，复用 stats 太重 —— feed 单独拆了 /api/feed
      const res = await fetch(`/api/feed?key=${encodeURIComponent(siteKey)}`);
      if (res.ok) {
        const j = await res.json();
        setItems(j.feed ?? []);
      }
    } catch {
      /* 静默重试 */
    }
  }, [siteKey]);

  useEffect(() => {
    setItems(initial);
    const timer = setInterval(load, 10000); // 10s 轮询实时动态
    return () => clearInterval(timer);
  }, [siteKey, initial, load]);

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-300">实时访问动态</h3>
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          10s 自动刷新
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-600">暂无访问，等待第一条上报…</p>
      ) : (
        <ul className="space-y-2 max-h-80 overflow-y-auto">
          {items.map((it, i) => (
            <li key={it.t + "-" + i} className="flex items-center gap-2 text-sm">
              <span className="text-xs text-gray-500 w-16 shrink-0">{timeAgo(it.t)}</span>
              <span className="text-xs w-14 shrink-0 text-gray-400">
                {DEVICE_LABEL[it.d] ?? it.d}
              </span>
              <span className="truncate text-gray-200 flex-1">{it.p}</span>
              <span className="text-xs text-gray-500 shrink-0 max-w-[100px] truncate">
                {it.r || "直接访问"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Dashboard({ fixedKey }: { fixedKey?: string }) {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [siteKey, setSiteKey] = useState(fixedKey ?? "");
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [, setTick] = useState(0); // 触发「N 秒前」重渲染

  const load = useCallback(async (key: string, d: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stats?key=${encodeURIComponent(key)}&days=${d}`);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json: StatsResponse = await res.json();
      setData(json);
      if (!key && json.activeKey) setSiteKey(json.activeKey);
      setError("");
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(siteKey, days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, fixedKey]);

  useEffect(() => {
    if (siteKey) load(siteKey, days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  // 「N 秒前」文案每 15s 刷新一次
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  if (loading && !data) {
    return <div className="py-32 text-center text-gray-500">加载中…</div>;
  }
  if (error) {
    return <div className="py-32 text-center text-red-400">{error}</div>;
  }
  if (!data) return null;

  if (data.sites.length === 0) {
    return (
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-12 text-center">
        <p className="text-lg mb-2">还没有接入任何站点</p>
        <p className="text-sm text-gray-500 mb-6">
          先到「站点管理」添加站点，生成嵌入代码后即可开始统计
        </p>
        <a
          href="/sites"
          className="inline-block rounded-lg bg-blue-600 hover:bg-blue-500 px-5 py-2 text-sm font-medium"
        >
          前往添加站点 →
        </a>
      </div>
    );
  }

  const s = data.summary;
  const activeSite = data.sites.find((x) => x.key === siteKey);

  return (
    <div className="space-y-6">
      {/* 站点选择（子页模式隐藏）+ 时间区间 */}
      <div className="flex flex-wrap items-center gap-3">
        {!fixedKey && (
          <select
            value={siteKey}
            onChange={(e) => setSiteKey(e.target.value)}
            className="rounded-lg bg-gray-900 border border-gray-800 px-3 py-1.5 text-sm"
          >
            {data.sites.map((x) => (
              <option key={x.key} value={x.key}>
                {x.name}
                {x.domain ? `（${x.domain}）` : ""}
              </option>
            ))}
          </select>
        )}
        <div className="flex rounded-lg overflow-hidden border border-gray-800">
          {DAYS_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                days === d ? "bg-blue-600 text-white" : "bg-gray-900 text-gray-400 hover:text-white"
              }`}
            >
              近 {d} 天
            </button>
          ))}
        </div>
        {activeSite && (
          <span className="text-xs text-gray-500 ml-auto">
            站点 KEY：<code className="text-gray-400">{activeSite.key}</code>
          </span>
        )}
      </div>

      {/* 指标卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="今日 PV（浏览量）"
          value={s.today.pv}
          delta={<Delta now={s.today.pv} prev={s.yesterday.pv} />}
          total={s.total.pv}
          accent="text-blue-400"
        />
        <MetricCard
          label="今日 UV（访客数）"
          value={s.today.uv}
          delta={<Delta now={s.today.uv} prev={s.yesterday.uv} />}
          total={s.total.uv}
          accent="text-emerald-400"
        />
        <MetricCard
          label="今日 IP（独立 IP）"
          value={s.today.ip}
          delta={<Delta now={s.today.ip} prev={s.yesterday.ip} />}
          total={s.total.ip}
          accent="text-amber-400"
        />
      </div>

      {/* 历史趋势 + 实时动态 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl bg-gray-900 border border-gray-800 p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-300">历史趋势</h3>
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">Redis 实时 {data.windowDays} 天</span>
              +
              <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">SQLite 归档</span>
            </span>
          </div>
          <TrendChart data={data.trend} />
        </div>
        <LiveFeed siteKey={siteKey} initial={data.feed} />
      </div>

      {/* 明细排行 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RankTable title="热门页面 Top 10" rows={data.details.pages.slice(0, 10)} />
        <RankTable title="来源分析 Top 10" rows={data.details.referrers.slice(0, 10)} />
      </div>
    </div>
  );
}
