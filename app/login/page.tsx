"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "登录失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-800 p-8"
      >
        <h1 className="text-xl font-bold text-center mb-1">📊 流量统计工作台</h1>
        <p className="text-sm text-gray-500 text-center mb-8">请输入管理员密码</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="管理员密码"
          autoFocus
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-sm mb-4 focus:outline-none focus:border-blue-500"
        />
        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-4 py-2.5 text-sm font-medium"
        >
          {loading ? "登录中…" : "登 录"}
        </button>
        <p className="text-xs text-gray-600 mt-6 text-center">
          默认密码 admin123，部署时请通过 ADMIN_PASSWORD 环境变量修改
        </p>
      </form>
    </div>
  );
}
