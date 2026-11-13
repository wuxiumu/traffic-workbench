import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

/**
 * 工作台统一布局（路由组 (dash)，不影响 URL）：
 * 所有登录后页面的页头由这里唯一渲染 —— 宽度/内边距/导航全站一致，杜绝样式漂移。
 * 各子页面只写内容，不要再包容器或引 TopBar。
 */
export default async function DashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isAuthenticated()) redirect("/login");
  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 pb-10">
        {children}
      </main>
    </div>
  );
}
