/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone 输出：Docker 镜像里只带最小运行时
  output: "standalone",
  experimental: {
    // Node 原生/纯 Node 依赖不打进服务端 bundle（ioredis 引用 crypto/dns 内建）
    serverComponentsExternalPackages: ["ioredis", "better-sqlite3", "node-cron"],
  },
};

export default nextConfig;
