#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_DIR="${COMPOSE_DIR:-$ROOT_DIR}"
COMPOSE_FILE="${COMPOSE_FILE:-$COMPOSE_DIR/docker-compose.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-astesia}"

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/astesia-docker}"
BACKUP_PREFIX="${BACKUP_PREFIX:-astesia-docker-state}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
RETENTION_COUNT="${RETENTION_COUNT:-30}"
LOG_TAIL="${LOG_TAIL:-300}"

INCLUDE_ENV="${INCLUDE_ENV:-1}"
INCLUDE_LOGS="${INCLUDE_LOGS:-1}"
INCLUDE_NGINX="${INCLUDE_NGINX:-1}"
NGINX_SITE_PATH="${NGINX_SITE_PATH:-/etc/nginx/sites-available/astesia-ai}"

CRON_MARKER="# astesia-docker-state-backup"
BACKUP_CRON_SCHEDULE="${BACKUP_CRON_SCHEDULE:-17 3 * * *}"
BACKUP_CRON_LOG="${BACKUP_CRON_LOG:-/var/log/astesia-docker-backup.log}"

log() {
  printf '\n\033[1;34m[backup]\033[0m %s\n' "$*"
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

capture() {
  local output_file="$1"
  shift

  if ! "$@" >"$output_file" 2>&1; then
    warn "命令执行失败，已保留输出：$* -> $output_file"
    return 0
  fi
}

copy_if_exists() {
  local source_path="$1"
  local target_path="$2"

  if [ ! -e "$source_path" ]; then
    warn "路径不存在，跳过：$source_path"
    return 0
  fi

  mkdir -p "$(dirname "$target_path")"
  cp -a "$source_path" "$target_path"
}

hash_file() {
  local input_file="$1"
  local output_file="$2"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$input_file" >"$output_file"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$input_file" >"$output_file"
  else
    warn "缺少 sha256sum/shasum，跳过哈希：$input_file"
  fi
}

write_metadata() {
  local output_file="$1"

  {
    printf 'timestamp=%s\n' "$(date -Is)"
    printf 'hostname=%s\n' "$(hostname 2>/dev/null || printf unknown)"
    printf 'user=%s\n' "$(id -un)"
    printf 'compose_dir=%s\n' "$COMPOSE_DIR"
    printf 'compose_file=%s\n' "$COMPOSE_FILE"
    printf 'compose_project_name=%s\n' "$COMPOSE_PROJECT_NAME"
    printf 'backup_root=%s\n' "$BACKUP_ROOT"
    printf 'include_env=%s\n' "$INCLUDE_ENV"
    printf 'include_logs=%s\n' "$INCLUDE_LOGS"
    printf 'include_nginx=%s\n' "$INCLUDE_NGINX"
  } >"$output_file"
}

backup_compose_config() {
  local backup_dir="$1"
  local config_dir="$backup_dir/config"
  local docker_dir="$backup_dir/docker"

  log "备份 Compose 与 Docker 构建配置"
  copy_if_exists "$COMPOSE_FILE" "$config_dir/docker-compose.yml"
  copy_if_exists "$COMPOSE_DIR/docker" "$config_dir/docker"
  copy_if_exists "$COMPOSE_DIR/.dockerignore" "$config_dir/.dockerignore"

  if [ -f "$COMPOSE_DIR/.env" ]; then
    if is_enabled "$INCLUDE_ENV"; then
      copy_if_exists "$COMPOSE_DIR/.env" "$config_dir/env/.env"
      chmod 600 "$config_dir/env/.env"
    else
      hash_file "$COMPOSE_DIR/.env" "$config_dir/env.sha256"
    fi
  else
    warn "未找到 .env，跳过运行期环境备份"
  fi

  capture "$docker_dir/compose.version.txt" docker compose version
  capture "$docker_dir/compose.config.yml" docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_FILE" config
  capture "$docker_dir/compose.ps.txt" docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_FILE" ps --all
  capture "$docker_dir/compose.services.txt" docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_FILE" config --services
}

backup_docker_state() {
  local backup_dir="$1"
  local docker_dir="$backup_dir/docker"
  local container_ids_file="$docker_dir/compose.container-ids.txt"
  local volume_names_file="$docker_dir/compose.volume-names.txt"
  local network_ids_file="$docker_dir/compose.network-ids.txt"
  local image_names_file="$docker_dir/astesia.image-names.txt"

  log "备份 Docker 容器、镜像、网络、卷状态"
  capture "$docker_dir/docker.version.txt" docker version
  capture "$docker_dir/docker.info.txt" docker info
  capture "$docker_dir/docker.system-df.txt" docker system df
  capture "$docker_dir/docker.ps.txt" docker ps --all --no-trunc
  capture "$docker_dir/docker.images.txt" docker image ls --digests --no-trunc
  capture "$docker_dir/docker.networks.txt" docker network ls --no-trunc
  capture "$docker_dir/docker.volumes.txt" docker volume ls

  docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_FILE" ps -q >"$container_ids_file" 2>/dev/null || true
  if [ -s "$container_ids_file" ]; then
    # shellcheck disable=SC2046
    docker inspect $(tr '\n' ' ' <"$container_ids_file") >"$docker_dir/compose.containers.inspect.json" 2>"$docker_dir/compose.containers.inspect.err" || true
  fi

  docker volume ls \
    --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
    --format '{{.Name}}' >"$volume_names_file" 2>/dev/null || true
  if [ -s "$volume_names_file" ]; then
    # shellcheck disable=SC2046
    docker volume inspect $(tr '\n' ' ' <"$volume_names_file") >"$docker_dir/compose.volumes.inspect.json" 2>"$docker_dir/compose.volumes.inspect.err" || true
  fi

  docker network ls \
    --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
    --format '{{.ID}}' >"$network_ids_file" 2>/dev/null || true
  if [ -s "$network_ids_file" ]; then
    # shellcheck disable=SC2046
    docker network inspect $(tr '\n' ' ' <"$network_ids_file") >"$docker_dir/compose.networks.inspect.json" 2>"$docker_dir/compose.networks.inspect.err" || true
  fi

  docker image ls --format '{{.Repository}}:{{.Tag}}' \
    | grep -E '^astesia-(web|backend|akshare):' >"$image_names_file" || true
  if [ -s "$image_names_file" ]; then
    # shellcheck disable=SC2046
    docker image inspect $(tr '\n' ' ' <"$image_names_file") >"$docker_dir/astesia.images.inspect.json" 2>"$docker_dir/astesia.images.inspect.err" || true
  fi

  capture "$docker_dir/docker.stats.txt" docker stats --no-stream --all
}

backup_host_state() {
  local backup_dir="$1"
  local host_dir="$backup_dir/host"

  log "备份宿主机关键运行状态"
  capture "$host_dir/uname.txt" uname -a
  capture "$host_dir/date.txt" date -Is
  capture "$host_dir/df.txt" df -h
  capture "$host_dir/free.txt" free -h
  capture "$host_dir/listen-ports.txt" sh -c 'ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null || true'

  if command -v pm2 >/dev/null 2>&1; then
    capture "$host_dir/pm2.list.txt" pm2 list
    capture "$host_dir/pm2.jlist.json" pm2 jlist
    copy_if_exists "$HOME/.pm2/dump.pm2" "$host_dir/pm2.dump.pm2"
  fi
}

backup_nginx_state() {
  local backup_dir="$1"
  local nginx_dir="$backup_dir/nginx"

  if ! is_enabled "$INCLUDE_NGINX"; then
    warn "已跳过 Nginx 配置备份：INCLUDE_NGINX=$INCLUDE_NGINX"
    return
  fi

  log "备份 Nginx 配置"
  copy_if_exists "$NGINX_SITE_PATH" "$nginx_dir/$(basename "$NGINX_SITE_PATH")"

  if command -v nginx >/dev/null 2>&1; then
    capture "$nginx_dir/nginx-test.txt" nginx -t
    capture "$nginx_dir/nginx-full-config.txt" nginx -T
  fi
}

backup_logs() {
  local backup_dir="$1"
  local logs_dir="$backup_dir/logs"

  if ! is_enabled "$INCLUDE_LOGS"; then
    warn "已跳过容器日志备份：INCLUDE_LOGS=$INCLUDE_LOGS"
    return
  fi

  log "备份最近容器日志"
  capture "$logs_dir/compose-tail.log" docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_FILE" logs --no-color --tail "$LOG_TAIL"
}

prune_old_archives() {
  if [ "$RETENTION_DAYS" -gt 0 ]; then
    find "$BACKUP_ROOT" -maxdepth 1 -type f \
      \( -name "$BACKUP_PREFIX-*.tar.gz" -o -name "$BACKUP_PREFIX-*.tar.gz.sha256" \) \
      -mtime +"$RETENTION_DAYS" -delete
  fi

  if [ "$RETENTION_COUNT" -gt 0 ] && compgen -G "$BACKUP_ROOT/$BACKUP_PREFIX-*.tar.gz" >/dev/null; then
    ls -1t "$BACKUP_ROOT"/"$BACKUP_PREFIX"-*.tar.gz \
      | tail -n +"$((RETENTION_COUNT + 1))" \
      | while IFS= read -r old_archive; do
          rm -f "$old_archive" "$old_archive.sha256"
        done
  fi
}

run_backup() {
  require_command docker
  require_command tar

  [ -f "$COMPOSE_FILE" ] || die "找不到 Compose 文件：$COMPOSE_FILE"

  local timestamp host_name backup_name work_dir archive_path
  timestamp="$(date +%Y%m%d-%H%M%S)"
  host_name="$(hostname -s 2>/dev/null | tr -c 'A-Za-z0-9._-' '-' | sed 's/-$//')"
  backup_name="$BACKUP_PREFIX-${host_name:-unknown}-$timestamp"
  work_dir="$BACKUP_ROOT/.$backup_name"
  archive_path="$BACKUP_ROOT/$backup_name.tar.gz"

  umask 077
  mkdir -p "$BACKUP_ROOT"
  chmod 700 "$BACKUP_ROOT"
  rm -rf "$work_dir"
  mkdir -p "$work_dir"/{config,docker,host,nginx,logs}

  trap 'rm -rf "$work_dir"' EXIT

  write_metadata "$work_dir/metadata.env"
  backup_compose_config "$work_dir"
  backup_docker_state "$work_dir"
  backup_host_state "$work_dir"
  backup_nginx_state "$work_dir"
  backup_logs "$work_dir"

  log "打包备份文件"
  tar -C "$BACKUP_ROOT" -czf "$archive_path" "$(basename "$work_dir")"
  chmod 600 "$archive_path"
  hash_file "$archive_path" "$archive_path.sha256"

  rm -rf "$work_dir"
  trap - EXIT

  prune_old_archives

  log "备份完成：$archive_path"
}

install_cron() {
  require_command crontab

  local tmp_file script_path
  tmp_file="$(mktemp)"
  script_path="$ROOT_DIR/scripts/backup-docker-state.sh"

  crontab -l >"$tmp_file" 2>/dev/null || true
  grep -vF "$CRON_MARKER" "$tmp_file" >"$tmp_file.new" || true
  printf '%s %s run >> %s 2>&1 %s\n' \
    "$BACKUP_CRON_SCHEDULE" \
    "$script_path" \
    "$BACKUP_CRON_LOG" \
    "$CRON_MARKER" >>"$tmp_file.new"
  crontab "$tmp_file.new"
  rm -f "$tmp_file" "$tmp_file.new"

  log "已安装定时备份：$BACKUP_CRON_SCHEDULE"
  log "日志文件：$BACKUP_CRON_LOG"
}

uninstall_cron() {
  require_command crontab

  local tmp_file
  tmp_file="$(mktemp)"
  crontab -l >"$tmp_file" 2>/dev/null || true
  grep -vF "$CRON_MARKER" "$tmp_file" >"$tmp_file.new" || true
  crontab "$tmp_file.new"
  rm -f "$tmp_file" "$tmp_file.new"

  log "已移除定时备份任务"
}

usage() {
  cat <<EOF
用法：
  $0 run             立即备份 Docker 配置和运行状态
  $0 install-cron    安装定时备份任务
  $0 uninstall-cron  移除定时备份任务

常用环境变量：
  COMPOSE_DIR=$COMPOSE_DIR
  COMPOSE_FILE=$COMPOSE_FILE
  COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME
  BACKUP_ROOT=$BACKUP_ROOT
  RETENTION_DAYS=$RETENTION_DAYS
  RETENTION_COUNT=$RETENTION_COUNT
  INCLUDE_ENV=$INCLUDE_ENV
  INCLUDE_LOGS=$INCLUDE_LOGS
  INCLUDE_NGINX=$INCLUDE_NGINX
  BACKUP_CRON_SCHEDULE="$BACKUP_CRON_SCHEDULE"
EOF
}

main() {
  case "${1:-run}" in
    run)
      run_backup
      ;;
    install-cron)
      install_cron
      ;;
    uninstall-cron)
      uninstall_cron
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      usage
      die "未知命令：$1"
      ;;
  esac
}

main "$@"
