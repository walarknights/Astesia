#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_ROOT="${ROOT_DIR}/.deploy"
APP_WEB_BUILD_DIR="${BUILD_ROOT}/expo-web"
ADMIN_WEB_BUILD_DIR="${BUILD_ROOT}/admin-web"

DEPLOY_TARGET="${DEPLOY_TARGET:-root@103.117.120.105}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://astesia.cc}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/root/Astesia}"
REMOTE_EXPO_WEB_DIR="${REMOTE_EXPO_WEB_DIR:-/var/www/astesia-app}"
REMOTE_ADMIN_WEB_DIR="${REMOTE_ADMIN_WEB_DIR:-/var/www/astesia-admin}"
PM2_PROCESS="${PM2_PROCESS:-astesia-ai}"

RUN_CHECKS="${RUN_CHECKS:-1}"
DEPLOY_BACKEND="${DEPLOY_BACKEND:-1}"
DEPLOY_EXPO_WEB="${DEPLOY_EXPO_WEB:-1}"
DEPLOY_ADMIN_WEB="${DEPLOY_ADMIN_WEB:-0}"
REMOTE_INSTALL="${REMOTE_INSTALL:-0}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-0}"
VERIFY_DEPLOY="${VERIFY_DEPLOY:-1}"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)
RSYNC_RSH="ssh -o BatchMode=yes -o ConnectTimeout=10"

log() {
  printf '\n\033[1;34m[deploy]\033[0m %s\n' "$*"
}

warn() {
  printf '\n\033[1;33m[warn]\033[0m %s\n' "$*" >&2
}

die() {
  printf '\n\033[1;31m[error]\033[0m %s\n' "$*" >&2
  exit 1
}

is_enabled() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

ssh_remote() {
  ssh "${SSH_OPTS[@]}" "$DEPLOY_TARGET" "$@"
}

prepare_local_tools() {
  require_command pnpm
  require_command rsync
  require_command ssh
  require_command curl
  require_command node
}

run_local_checks() {
  if ! is_enabled "$RUN_CHECKS"; then
    warn "已跳过本地检查：RUN_CHECKS=$RUN_CHECKS"
    return
  fi

  log "运行本地类型、Lint 和后端语法检查"
  (
    cd "$ROOT_DIR"
    pnpm exec tsc --noEmit
    pnpm lint
    node --check server/ai-server.mjs
  )

  if is_enabled "$DEPLOY_ADMIN_WEB"; then
    log "运行管理端 Lint"
    (
      cd "$ROOT_DIR/admin-web"
      pnpm lint
    )
  fi
}

build_expo_web() {
  if ! is_enabled "$DEPLOY_EXPO_WEB"; then
    warn "已跳过 Expo Web 构建：DEPLOY_EXPO_WEB=$DEPLOY_EXPO_WEB"
    return
  fi

  log "构建 Expo Web 前端"
  rm -rf "$APP_WEB_BUILD_DIR"
  (
    cd "$ROOT_DIR"
    EXPO_PUBLIC_AI_API_HOST="$PUBLIC_BASE_URL" \
      pnpm exec expo export --platform web --output-dir "$APP_WEB_BUILD_DIR"
  )
}

build_admin_web() {
  if ! is_enabled "$DEPLOY_ADMIN_WEB"; then
    return
  fi

  log "构建管理端 Web"
  rm -rf "$ADMIN_WEB_BUILD_DIR"
  (
    cd "$ROOT_DIR/admin-web"
    pnpm exec tsc -b
    VITE_API_BASE_URL="$PUBLIC_BASE_URL" \
      pnpm exec vite build --outDir "$ADMIN_WEB_BUILD_DIR" --emptyOutDir
  )
}

prepare_remote() {
  log "检查远端环境：$DEPLOY_TARGET"
  ssh_remote "
    set -e
    command -v pm2 >/dev/null
    command -v node >/dev/null
    test -d '$REMOTE_APP_DIR'
    mkdir -p '$REMOTE_APP_DIR/server'
    mkdir -p '$REMOTE_APP_DIR/app'
    mkdir -p '$REMOTE_APP_DIR/services'
    mkdir -p '$REMOTE_EXPO_WEB_DIR'
    mkdir -p '$REMOTE_ADMIN_WEB_DIR'
  "
}

sync_backend_and_app_source() {
  if ! is_enabled "$DEPLOY_BACKEND"; then
    warn "已跳过后端源码同步：DEPLOY_BACKEND=$DEPLOY_BACKEND"
    return
  fi

  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"

  log "备份并同步后端与 App 源码"
  ssh_remote "
    set -e
    if [ -f '$REMOTE_APP_DIR/server/ai-server.mjs' ]; then
      cp '$REMOTE_APP_DIR/server/ai-server.mjs' '$REMOTE_APP_DIR/server/ai-server.mjs.bak-$timestamp'
    fi
  "

  rsync -az \
    --exclude '.DS_Store' \
    --exclude 'node_modules' \
    --exclude '.expo' \
    --exclude 'dist' \
    --exclude '.deploy' \
    -e "$RSYNC_RSH" \
    "$ROOT_DIR/server/" \
    "$DEPLOY_TARGET:$REMOTE_APP_DIR/server/"

  rsync -az \
    --exclude '.DS_Store' \
    --exclude 'node_modules' \
    --exclude '.expo' \
    --exclude 'dist' \
    --exclude '.deploy' \
    -e "$RSYNC_RSH" \
    "$ROOT_DIR/app" \
    "$ROOT_DIR/components" \
    "$ROOT_DIR/constants" \
    "$ROOT_DIR/hooks" \
    "$ROOT_DIR/services" \
    "$ROOT_DIR/styles" \
    "$ROOT_DIR/assets" \
    "$ROOT_DIR/public" \
    "$ROOT_DIR/app.json" \
    "$ROOT_DIR/package.json" \
    "$ROOT_DIR/pnpm-lock.yaml" \
    "$ROOT_DIR/tsconfig.json" \
    "$DEPLOY_TARGET:$REMOTE_APP_DIR/"
}

sync_expo_web() {
  if ! is_enabled "$DEPLOY_EXPO_WEB"; then
    return
  fi

  log "上传 Expo Web 静态产物到 $REMOTE_EXPO_WEB_DIR"
  rsync -az --delete -e "$RSYNC_RSH" \
    "$APP_WEB_BUILD_DIR/" \
    "$DEPLOY_TARGET:$REMOTE_EXPO_WEB_DIR/"

  if ! ssh_remote "nginx -T 2>/dev/null | grep -F '$REMOTE_EXPO_WEB_DIR' >/dev/null"; then
    warn "当前 Nginx 配置未引用 $REMOTE_EXPO_WEB_DIR；静态产物已上传，但需要配置站点路由后才会对外可见。"
  fi
}

sync_admin_web() {
  if ! is_enabled "$DEPLOY_ADMIN_WEB"; then
    return
  fi

  log "上传管理端静态产物到 $REMOTE_ADMIN_WEB_DIR"
  rsync -az --delete -e "$RSYNC_RSH" \
    "$ADMIN_WEB_BUILD_DIR/" \
    "$DEPLOY_TARGET:$REMOTE_ADMIN_WEB_DIR/"
}

run_remote_install_if_needed() {
  if ! is_enabled "$REMOTE_INSTALL"; then
    return
  fi

  log "远端安装生产依赖"
  ssh_remote "
    set -e
    cd '$REMOTE_APP_DIR'
    pnpm install --frozen-lockfile --prod
  "
}

run_remote_migrations_if_needed() {
  if ! is_enabled "$RUN_MIGRATIONS"; then
    return
  fi

  log "执行远端数据库迁移"
  ssh_remote "
    set -e
    cd '$REMOTE_APP_DIR'
    pnpm run db:migrate
  "
}

restart_backend() {
  if ! is_enabled "$DEPLOY_BACKEND"; then
    return
  fi

  log "重启 PM2 后端进程：$PM2_PROCESS"
  ssh_remote "
    set -e
    cd '$REMOTE_APP_DIR'
    pm2 restart '$PM2_PROCESS' --update-env
  "
}

verify_deploy() {
  if ! is_enabled "$VERIFY_DEPLOY"; then
    warn "已跳过部署验证：VERIFY_DEPLOY=$VERIFY_DEPLOY"
    return
  fi

  log "验证公开接口"
  curl -fsS "$PUBLIC_BASE_URL/health" >/dev/null
  curl -fsS "$PUBLIC_BASE_URL/api/ai/models" >/dev/null
  curl -fsS "$PUBLIC_BASE_URL/api/ai/model-pricing" >/dev/null

  if is_enabled "$DEPLOY_ADMIN_WEB"; then
    curl -fsSI "$PUBLIC_BASE_URL/admin/" >/dev/null
  fi

  log "部署验证通过"
}

main() {
  cd "$ROOT_DIR"

  log "部署目标：$DEPLOY_TARGET"
  log "后端目录：$REMOTE_APP_DIR"
  log "Expo Web 目录：$REMOTE_EXPO_WEB_DIR"

  prepare_local_tools
  run_local_checks
  build_expo_web
  build_admin_web
  prepare_remote
  sync_backend_and_app_source
  sync_expo_web
  sync_admin_web
  run_remote_install_if_needed
  run_remote_migrations_if_needed
  restart_backend
  verify_deploy

  log "部署完成"
}

main "$@"
