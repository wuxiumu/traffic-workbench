"use client";

import { useCallback, useEffect, useState } from "react";

type Site = {
  id: number;
  name: string;
  domain: string;
  site_key: string;
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
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

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

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
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
    } finally {
      setCreating(false);
    }
  };

  const remove = async (key: string, siteName: string) => {
    if (!confirm(`确定删除站点「${siteName}」？该站点的全部统计数据将一并清除。`)) return;
    await fetch(`/api/sites?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    load();
  };

  const snippet = (key: string) =>
    `<script async src="${origin}/m.js" data-key="${key}"></script>`;

  return (
    <div className="space-y-8">
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
            disabled={creating || !name.trim()}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-medium"
          >
            {creating ? "创建中…" : "创建站点"}
          </button>
        </div>
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
      </form>

      {/* 站点列表 */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-300">站点列表（{sites.length}）</h2>
        {sites.length === 0 && (
          <p className="text-sm text-gray-600 py-8 text-center">还没有站点，先在上方添加一个</p>
        )}
        {sites.map((s) => (
          <div key={s.id} className="rounded-xl bg-gray-900 border border-gray-800 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="font-medium">{s.name}</span>
                {s.domain && <span className="text-sm text-gray-500 ml-2">{s.domain}</span>}
                <span className="text-xs text-gray-600 ml-3">
                  KEY <code className="text-gray-400">{s.site_key}</code>
                </span>
              </div>
              <div className="flex gap-2">
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
