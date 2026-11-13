"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function TopBar() {
  const router = useRouter();
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-6">
        <h1 className="text-xl font-bold tracking-wide">📊 流量统计工作台</h1>
        <nav className="flex gap-4 text-sm text-gray-400">
          <Link href="/" className="hover:text-white transition-colors">
            数据大盘
          </Link>
          <Link href="/sites" className="hover:text-white transition-colors">
            站点管理
          </Link>
        </nav>
      </div>
      <button
        onClick={logout}
        className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        退出登录
      </button>
    </header>
  );
}
