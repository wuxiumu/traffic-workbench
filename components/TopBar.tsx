"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";

const NAV = [
  { href: "/", label: "数据大盘" },
  { href: "/universal", label: "万能统计" },
  { href: "/sites", label: "站点管理" },
];

export default function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="border-b border-gray-800 bg-gray-950/80 mb-6">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-6">
        <h1 className="text-lg font-bold tracking-wide shrink-0">
          📊 流量统计工作台
        </h1>
        <nav className="flex gap-1 text-sm">
          {NAV.map((n) => {
            const active =
              n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  active
                    ? "bg-gray-800 text-white font-medium"
                    : "text-gray-400 hover:text-white hover:bg-gray-900"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={logout}
          className="ml-auto text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          退出登录
        </button>
      </div>
    </header>
  );
}
