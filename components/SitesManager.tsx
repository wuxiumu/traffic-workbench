"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Site = {
  id: number;
  name: string;
  domain: string;
  site_key: string;
};

type PendingImport = {
  payload: {
    version: number;
    exportedAt: number;
    sites: { key: string; name: string; domain: string }[];
    events: unknown[];
  };
  fileName: string;
};

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

export default function SitesManager() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importChecked, setImportChecked] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/sites");
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    const j = await res.json();
    setSites(j.sites ?? []);
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    load();
  }, [load]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === sites.length ? new Set() : new Set(sites.map((s) => s.site_key))
    );
  const selKeys = [...selected];

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 6000);
  };

  const requireSel = () => {
    if (selKeys.length === 0) {
      setError("请先勾选站点");
      return false;
    }
    return true;
  };

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    void withBusy(async () => {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, domain }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "创建失败");
        return;
      }
      setName("");
      setDomain("");
      setExpanded(j.siteKey);
      load();
    });
  };

  const remove = (key: string, siteName: string) => {
    if (!confirm(`确定删除站点「${siteName}」？该站点的全部统计数据将一并清除。`)) return;
    void withBusy(async () => {
      await fetch(`/api/sites?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
      load();
    });
  };

  /** 多选：清空统计数据（保留站点） */
  const resetSelected = () => {
    if (!requireSel()) return;
    if (
      !confirm(
        `确定清空所选 ${selKeys.length} 个站点的全部统计数据？\n站点配置保留，清空后可通过「灌演示数据」或「导入」恢复。`
      )
    )
      return;
    void withBusy(async () => {
      const res = await fetch("/api/sites/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: selKeys }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "清空失败");
        return;
      }
      flash(`✅ 已清空 ${j.cleared} 个站点的统计数据（配置保留）。可点「灌演示数据」恢复测试数据，或用「导入数据」恢复真实数据。`);
      load();
    });
  };

  /** 多选：导出 JSON 下载 */
  const exportSelected = () => {
    if (!requireSel()) return;
    void withBusy(async () => {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: selKeys }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "导出失败");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `traffic-export-${selKeys.length}-sites.json`;
      a.click();
      URL.revokeObjectURL(url);
      flash(`✅ 已导出 ${selKeys.length} 个站点（含事件明细），可用于备份或迁移。`);
    });
  };

  /** 多选：灌演示数据 */
  const demoSelected = () => {
    if (!requireSel()) return;
    if (!confirm(`为所选 ${selKeys.length} 个站点灌入 30 天演示数据？\n现有统计数据会先被清空。`)) return;
    void withBusy(async () => {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: selKeys }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "生成失败");
        return;
      }
      const n = j.results?.reduce((a: number, r: { events: number }) => a + r.events, 0) ?? 0;
      flash(`✅ 已为 ${selKeys.length} 个站点生成 ${n} 条演示事件（30 天）。去「数据大盘」查看效果。`);
      load();
    });
  };

  /** 第一步：选择文件并解析 */
  const pickImportFile = () => {
    fileRef.current?.click();
  };
  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    void withBusy(async () => {
      const text = await f.text();
      let payload: PendingImport["payload"];
      try {
        payload = JSON.parse(text);
      } catch {
        setError("文件不是合法 JSON");
        return;
      }
      if (payload?.version !== 1 || !Array.isArray(payload.sites)) {
        setError("不是本系统导出的数据文件（缺少 version/sites 字段）");
        return;
      }
      setPendingImport({ payload, fileName: f.name });
      setImportChecked(new Set(payload.sites.map((s) => s.key)));
    });
  };

  /** 第二步：确认导入所选站点 */
  const confirmImport = () => {
    if (!pendingImport) return;
    if (importChecked.size === 0) {
      setError("请至少勾选一个要导入的站点");
      return;
    }
    void withBusy(async () => {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: pendingImport.payload,
          keys: [...importChecked],
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "导入失败");
        return;
      }
      const n = j.summary?.reduce((a: number, s: { eventsImported: number }) => a + s.eventsImported, 0) ?? 0;
      flash(`✅ 已导入 ${j.summary.length} 个站点、${n} 条事件（按日期段替换，重复导入不会产生重复数据）。`);
      setPendingImport(null);
      load();
    });
  };

  const snippet = (key: string) =>
    `<script async src="${origin}/m.js" data-key="${key}"></script>`;

  return (
    <div className="space-y-6">
      {/* 新建站点 */}
      <form onSubmit={create} className="rounded-xl bg-gray-900 border border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">➕ 添加站点</h2>
        <div className="flex flex-wrap gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="站点名称，如：我的博客"
            className="flex-1 min-w-[200px] rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="域名（可选），如：blog.example.com"
            className="flex-1 min-w-[200px] rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-medium"
          >
            创建站点
          </button>
        </div>
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        {notice && (
          <p className="text-sm text-emerald-400 mt-3 whitespace-pre-wrap">{notice}</p>
        )}
      </form>

      {/* 批量操作工具栏 */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-gray-300">
            已选 {selected.size}/{sites.length}
          </span>
          <button
            onClick={toggleAll}
            disabled={sites.length === 0}
            className="rounded-md bg-gray-800 hover:bg-gray-700 px-2.5 py-1 text-xs font-medium disabled:opacity-40"
          >
            {selected.size === sites.length && sites.length > 0 ? "取消全选" : "全选"}
          </button>
          <span className="text-gray-700">|</span>
          <button
            onClick={exportSelected}
            disabled={busy || selected.size === 0}
            className="rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-3 py-1.5 text-xs font-medium"
          >
            ⬇ 导出数据（JSON）
          </button>
          <button
            onClick={pickImportFile}
            disabled={busy}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-3 py-1.5 text-xs font-medium"
          >
            ⬆ 导入数据
          </button>
          <button
            onClick={resetSelected}
            disabled={busy || selected.size === 0}
            className="rounded-md bg-amber-700 hover:bg-amber-600 disabled:opacity-40 px-3 py-1.5 text-xs font-medium"
          >
            🧹 清空所选数据
          </button>
          <button
            onClick={demoSelected}
            disabled={busy || selected.size === 0}
            className="rounded-md bg-purple-700 hover:bg-purple-600 disabled:opacity-40 px-3 py-1.5 text-xs font-medium"
          >
            🎲 灌演示数据
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={onFileChosen}
            className="hidden"
          />
        </div>
        <p className="text-xs text-gray-600 mt-3">
          数据全部清空后：点「🎲 灌演示数据」恢复测试数据，或点「⬆ 导入数据」恢复之前导出的真实数据（支持多选站点）。
        </p>
      </div>

      {/* 导入向导（第二步） */}
      {pendingImport && (
        <div className="rounded-xl bg-gray-900 border border-emerald-800 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-1">
            ⬆ 确认导入 — {pendingImport.fileName}
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            文件含 {pendingImport.payload.sites.length} 个站点、{pendingImport.payload.events.length}{" "}
            条事件。勾选要导入的站点；同名站点将更新配置，数据按日期段替换（重复导入不会重复）。
          </p>
          <div className="space-y-2 mb-4">
            {pendingImport.payload.sites.map((s) => {
              const exists = sites.some((x) => x.site_key === s.key);
              return (
                <label
                  key={s.key}
                  className="flex items-center gap-3 rounded-lg bg-gray-800 px-3 py-2 cursor-pointer hover:bg-gray-750"
                >
                  <input
                    type="checkbox"
                    checked={importChecked.has(s.key)}
                    onChange={() =>
                      setImportChecked((prev) => {
                        const n = new Set(prev);
                        if (n.has(s.key)) n.delete(s.key);
                        else n.add(s.key);
                        return n;
                      })
                    }
                    className="accent-emerald-500"
                  />
                  <span className="text-sm text-gray-200">{s.name}</span>
                  <code className="text-xs text-gray-500">{s.key}</code>
                  {s.domain && <span className="text-xs text-gray-600">{s.domain}</span>}
                  <span
                    className={`text-xs ml-auto ${
                      exists ? "text-amber-400" : "text-emerald-400"
                    }`}
                  >
                    {exists ? "已存在（更新合并）" : "新站点"}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="flex gap-3">
            <button
              onClick={confirmImport}
              disabled={busy}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm font-medium"
            >
              {busy ? "导入中…" : `导入所选（${importChecked.size}）`}
            </button>
            <button
              onClick={() => setPendingImport(null)}
              disabled={busy}
              className="rounded-lg bg-gray-800 hover:bg-gray-700 px-4 py-2 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 站点列表 */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-300">站点列表（{sites.length}）</h2>
        {sites.length === 0 && (
          <p className="text-sm text-gray-600 py-8 text-center">
            还没有站点，先在上方添加一个
          </p>
        )}
        {sites.map((s) => (
          <div key={s.id} className="rounded-xl bg-gray-900 border border-gray-800 p-5">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selected.has(s.site_key)}
                onChange={() => toggle(s.site_key)}
                className="accent-blue-500 shrink-0"
                title="勾选后可用上方批量操作"
              />
              <div className="min-w-0 flex-1">
                <span className="font-medium">{s.name}</span>
                {s.domain && <span className="text-sm text-gray-500 ml-2">{s.domain}</span>}
                <span className="text-xs text-gray-600 ml-3">
                  KEY <code className="text-gray-400">{s.site_key}</code>
                </span>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setExpanded(expanded === s.site_key ? null : s.site_key)}
                  className="rounded-md bg-gray-700 hover:bg-gray-600 px-2.5 py-1 text-xs font-medium"
                >
                  {expanded === s.site_key ? "收起代码" : "接入代码"}
                </button>
                <button
                  onClick={() => remove(s.site_key, s.name)}
                  className="rounded-md bg-gray-800 hover:bg-red-900/60 text-gray-400 hover:text-red-300 px-2.5 py-1 text-xs font-medium transition-colors"
                >
                  删除
                </button>
              </div>
            </div>
            {expanded === s.site_key && (
              <div className="mt-4 rounded-lg bg-gray-950 border border-gray-800 p-4">
                <p className="text-xs text-gray-500 mb-2">
                  将下面这段代码粘贴到目标网站每个页面的 <code>&lt;head&gt;</code> 中（单页应用放入口
                  HTML 即可，自动支持 SPA 路由）：
                </p>
                <div className="flex items-start gap-2">
                  <pre className="flex-1 overflow-x-auto text-xs text-emerald-300 leading-relaxed">
                    {snippet(s.site_key)}
                  </pre>
                  <CopyButton text={snippet(s.site_key)} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
