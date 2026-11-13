import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "流量统计工作台",
  description: "自托管网站流量统计：PV / UV / IP 与历史趋势",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-950 text-gray-100 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
