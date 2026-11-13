import { redirect, notFound } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { listSites } from "@/lib/stats";
import Dashboard from "@/components/Dashboard";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

/** 单站点详情页：/site/{siteKey} */
export default async function SiteDetail({
  params,
}: {
  params: { key: string };
}) {
  if (!isAuthenticated()) redirect("/login");
  const site = listSites().find((s) => s.site_key === params.key);
  if (!site) notFound();

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <TopBar />
      <div className="mb-4 flex items-center gap-3">
        <a
          href="/"
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          ← 返回总览
        </a>
        <span className="text-gray-700">/</span>
        <span className="text-sm text-gray-300">
          {site.domain || site.name}
          <span className="text-gray-600 ml-2">{site.name}</span>
        </span>
      </div>
      <Dashboard fixedKey={site.site_key} />
    </div>
  );
}
