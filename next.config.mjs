/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone 输出仅用于 Docker 镜像（Dockerfile 里设 DOCKER_BUILD=1）；
  // 本地 `next start` 与 standalone 不兼容（Next 14 会警告）
  ...(process.env.DOCKER_BUILD ? { output: "standalone" } : {}),
  experimental: {
    // Node 原生/纯 Node 依赖不打进服务端 bundle（ioredis 引用 crypto/dns 内建）
    serverComponentsExternalPackages: ["ioredis", "better-sqlite3", "node-cron"],
  },
};

export default nextConfig;
