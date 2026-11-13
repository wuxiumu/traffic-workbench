#!/usr/bin/env bash
# ==============================================================================
# 流量统计工作台 · 启停管理脚本（本地开发 & 服务器部署通用）
#
# 用法：
#   ./tw.sh start [--dev] [--docker]   启动（--dev 开发模式热更新；--docker 走容器）
#   ./tw.sh stop    [--docker]         停止
#   ./tw.sh restart [--dev] [--docker] 重启
#   ./tw.sh status  [--docker]         状态（进程 + 健康探针 + Redis）
#   ./tw.sh logs    [--docker] [-f] [N]日志（默认最近 100 行，-f 跟踪，N 指定行数）
#   ./tw.sh seed                       灌演示数据（3 域名 × 30 天）
#
# 执行前会自动检查环境：Node ≥18、依赖安装、Redis 可用（本地模式）、Docker（容器模式）、
# 端口占用；发现缺失会给出安装提示或自动拉起（本地 Redis）。
#
# 本地模式文件：PID/.run/app.pid，日志/.run/app.log，本地 Redis 数据/.run/redis
# ==============================================================================
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-3000}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
RUN_DIR=".run"
PID_FILE="$RUN_DIR/app.pid"
LOG_FILE="$RUN_DIR/app.log"
REDIS_DIR="$RUN_DIR/redis"

ACTION="${1:-}"; shift || true
DEV=0; DOCKER=0; FOLLOW=0; LINES=100
while [ $# -gt 0 ]; do
  case "$1" in
    --dev) DEV=1 ;;
    --docker) DOCKER=1 ;;
    -f) FOLLOW=1 ;;
    [0-9]*) LINES="$1" ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
  shift
done

info()  { echo "ℹ️  $*"; }
ok()    { echo "✅ $*"; }
warn()  { echo "⚠️  $*"; }
fail()  { echo "❌ $*"; exit 1; }

# ---------- Docker 模式可用性 ----------
check_docker() {
  command -v docker >/dev/null 2>&1 || fail "未安装 docker（服务器部署需先安装 Docker Engine + Compose 插件）"
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    fail "缺少 Docker Compose 插件（docker compose version 检查失败）"
  fi
  [ -f docker-compose.yml ] || fail "未找到 docker-compose.yml"
  [ -f .env ] || warn "未找到 .env（将使用默认密码 admin123！生产环境务必创建 .env 设置 ADMIN_PASSWORD/IP_SALT/CRON_SECRET）"
}

# ---------- 本地模式环境检查 ----------
check_local() {
  command -v node >/dev/null 2>&1 || fail "未安装 Node.js（需 ≥18）：https://nodejs.org 或 brew install node"
  local major; major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge 18 ] || fail "Node 版本过低（$(node -v)），需要 ≥18"

  [ -d node_modules ] || { info "安装依赖…"; npm install; }

  # Redis：可用则跳过；已安装未运行则自动拉起（AOF 持久化到 .run/redis）；未安装则提示
  if ! redis-cli ping >/dev/null 2>&1; then
    if command -v redis-server >/dev/null 2>&1; then
      info "启动本地 Redis（AOF 持久化 → ${REDIS_DIR}）…"
      mkdir -p "$REDIS_DIR"
      redis-server --daemonize yes --save '' --appendonly yes \
        --appendfilename "appendonly.aof" --dir "$REDIS_DIR" >/dev/null
      sleep 1
      redis-cli ping >/dev/null 2>&1 || fail "Redis 启动失败，请手动检查：redis-server --daemonize yes"
      ok "Redis 已启动"
    else
      fail "Redis 不可用且未安装。macOS: brew install redis ｜ Ubuntu/Debian: apt install redis-server"
    fi
  fi

  # 构建产物检查（生产模式）
  if [ "$DEV" -eq 0 ] && [ ! -f .next/BUILD_ID ] && [ "${BUILD_ON_START:-0}" != "1" ]; then
    info "未发现构建产物，执行 npm run build…"
    npm run build
  fi
}

# ---------- 本地模式启停 ----------
app_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

do_start_local() {
  if app_running; then
    warn "已在运行（PID $(cat "$PID_FILE")），如需重启请用 ./tw.sh restart"
    exit 0
  fi
  # 端口被非本服务进程占用 → 拒绝启动
  if curl -s -o /dev/null --max-time 2 "$HEALTH_URL"; then
    warn "端口 ${PORT} 已有服务响应（可能上次未正常退出）。先执行 ./tw.sh stop 或换 PORT=xxxx ./tw.sh start"
    exit 1
  fi
  mkdir -p "$RUN_DIR"
  : > "$LOG_FILE"

  # 标签（注意：变量一律用 ${VAR} 花括号包裹，避免紧跟中文时在 C locale 下被并进变量名）
  local label="生产模式"
  [ "$DEV" -eq 1 ] && label="开发模式"
  info "启动中（${label}，端口 ${PORT}）…"
  if [ "$DEV" -eq 1 ]; then
    nohup ./node_modules/.bin/next dev -p "$PORT" >> "$LOG_FILE" 2>&1 &
  else
    nohup ./node_modules/.bin/next start -p "$PORT" >> "$LOG_FILE" 2>&1 &
  fi
  echo $! > "$PID_FILE"

  # 健康等待（开发模式首次编译较慢，放宽到 90s）
  local timeout=60
  [ "$DEV" -eq 1 ] && timeout=90
  printf "ℹ️  等待服务就绪"
  for _ in $(seq 1 "$timeout"); do
    if curl -s -o /dev/null --max-time 2 "$HEALTH_URL"; then
      echo
      ok "服务已就绪 → http://localhost:${PORT}（默认密码 admin123，日志: ${LOG_FILE}）"
      return
    fi
    printf '.'
    sleep 1
  done
  echo
  fail "启动超时，查看日志: tail -n 50 $LOG_FILE"
}

do_stop_local() {
  if ! app_running; then
    warn "本脚本未管理运行中的进程（无 PID 文件）"
    return
  fi
  local pid; pid=$(cat "$PID_FILE")
  info "停止 PID ${pid}…"
  kill "$pid" 2>/dev/null || true
  pkill -TERM -P "$pid" 2>/dev/null || true # 开发模式的子进程
  for _ in $(seq 1 10); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  kill -0 "$pid" 2>/dev/null && { warn "强制结束"; kill -9 "$pid" 2>/dev/null || true; pkill -KILL -P "$pid" 2>/dev/null || true; }
  rm -f "$PID_FILE"
  ok "已停止"
}

do_status_local() {
  if app_running; then
    ok "进程运行中（PID $(cat "$PID_FILE")）"
  else
    warn "进程未运行"
  fi
  if curl -s --max-time 2 "$HEALTH_URL" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log('健康探针: status='+j.status+' db='+j.db+' redis='+j.redis+' rss='+j.procRssMB+'MB')}catch{console.log('健康探针: 无响应')}})" 2>/dev/null
  then :; fi
  redis-cli ping >/dev/null 2>&1 && ok "Redis: PONG" || warn "Redis: 不可用"
}

do_logs_local() {
  [ -f "$LOG_FILE" ] || warn "暂无日志文件 $LOG_FILE"
  if [ "$FOLLOW" -eq 1 ]; then
    tail -n "$LINES" -f "$LOG_FILE"
  else
    tail -n "$LINES" "$LOG_FILE" 2>/dev/null || true
  fi
}

# ---------- Docker 模式启停 ----------
do_start_docker() {
  info "Docker Compose 构建并启动（app + redis）…"
  "${COMPOSE[@]}" up -d --build
  info -n "等待服务就绪"
  for _ in $(seq 1 90); do
    if curl -s -o /dev/null --max-time 2 "$HEALTH_URL"; then
      echo; ok "服务已就绪 → http://localhost:${PORT}"
      "${COMPOSE[@]}" ps
      return
    fi
    printf '.'; sleep 1
  done
  echo; fail "启动超时，查看日志: ./tw.sh logs --docker"
}

do_stop_docker()  { "${COMPOSE[@]}" down; ok "已停止"; }
do_logs_docker()  {
  if [ "$FOLLOW" -eq 1 ]; then "${COMPOSE[@]}" logs -f --tail "$LINES"; else "${COMPOSE[@]}" logs --tail "$LINES"; fi
}
do_status_docker() {
  "${COMPOSE[@]}" ps
  curl -s --max-time 2 "$HEALTH_URL" | head -c 200 && echo || warn "健康探针无响应"
}

# ---------- 分发 ----------
case "$ACTION" in
  start)
    [ "$DOCKER" -eq 1 ] && { check_docker; do_start_docker; } || { check_local; do_start_local; }
    ;;
  stop)
    [ "$DOCKER" -eq 1 ] && { check_docker; do_stop_docker; } || do_stop_local
    ;;
  restart)
    [ "$DOCKER" -eq 1 ] && { check_docker; do_stop_docker; do_start_docker; } || { check_local; do_stop_local; do_start_local; }
    ;;
  status)
    [ "$DOCKER" -eq 1 ] && { check_docker; do_status_docker; } || do_status_local
    ;;
  logs)
    [ "$DOCKER" -eq 1 ] && { check_docker; do_logs_docker; } || do_logs_local
    ;;
  seed)
    [ -d node_modules ] || npm install
    npm run seed
    ;;
  "")
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    echo "未指定命令。用法: ./tw.sh {start|stop|restart|status|logs|seed} [--dev] [--docker] [-f] [行数]"
    ;;
  *)
    fail "未知命令: ${ACTION}（支持 start/stop/restart/status/logs/seed）"
    ;;
esac
