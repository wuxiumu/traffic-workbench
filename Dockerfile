# ---------- 构建阶段 ----------
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# standalone 输出（仅容器构建启用，见 next.config.mjs）
ENV DOCKER_BUILD=1
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV APP_TZ=Asia/Shanghai

# standalone 产物 + 静态资源
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 数据目录（挂载卷）
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "server.js"]
