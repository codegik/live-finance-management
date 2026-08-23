#!/usr/bin/env bash
#
# Stop the Next.js dev server and the local Postgres container.
# Database contents survive by default.
#
#   ./stop.sh            stop the app and the database container
#   ./stop.sh --remove   also delete the container (keeps the data volume)
#   ./stop.sh --purge    delete the container AND its data volume (irreversible)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

DB_CONTAINER="${DB_CONTAINER:-finance-db}"
DB_VOLUME="${DB_VOLUME:-finance-db-data}"

PID_FILE="$ROOT/.dev-server.pid"

if [ -t 1 ]; then
  C_INFO=$'\033[0;36m'; C_OK=$'\033[0;32m'; C_WARN=$'\033[0;33m'
  C_ERR=$'\033[0;31m'; C_OFF=$'\033[0m'
else
  C_INFO=''; C_OK=''; C_WARN=''; C_ERR=''; C_OFF=''
fi
info() { printf '%s==>%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s   !%s %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
die()  { printf '%sError:%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }

container_state() {
  # docker inspect prints an empty line to stdout before failing on a missing
  # container, so test the captured value rather than trusting the exit code.
  local state
  state="$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null)" || state=''
  if [ -n "$state" ]; then printf '%s' "$state"; else printf 'missing'; fi
}

app_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

REMOVE_CONTAINER=false
PURGE_DATA=false
for arg in "$@"; do
  case "$arg" in
    --remove | -r) REMOVE_CONTAINER=true ;;
    --purge) REMOVE_CONTAINER=true; PURGE_DATA=true ;;
    -h | --help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $arg (try --help)" ;;
  esac
done

stop_app() {
  local pid
  if ! pid="$(app_pid)"; then
    if [ -f "$PID_FILE" ]; then
      rm -f "$PID_FILE"
      ok "Dev server was not running (cleared a stale pid file)"
    else
      ok "Dev server not running"
    fi
    return
  fi

  info "Stopping dev server (pid $pid)"
  # Signal the whole process group when start.sh created one, so pnpm's child
  # next process goes down too; fall back to the single pid.
  kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true

  local i=0
  while [ "$i" -lt 15 ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      ok "Dev server stopped"
      return
    fi
    i=$((i + 1))
    sleep 1
  done

  warn "Dev server ignored SIGTERM; sending SIGKILL"
  kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  ok "Dev server killed"
}

stop_db() {
  command -v docker >/dev/null 2>&1 || { warn "docker not found; skipping database"; return; }
  docker info >/dev/null 2>&1 || { warn "Docker daemon not running; skipping database"; return; }

  case "$(container_state)" in
    missing) ok "Postgres container not present" ;;
    running | paused)
      info "Stopping Postgres container"
      docker stop "$DB_CONTAINER" >/dev/null
      ok "Postgres stopped"
      ;;
    *) ok "Postgres already stopped" ;;
  esac

  if [ "$REMOVE_CONTAINER" = true ] && [ "$(container_state)" != missing ]; then
    info "Removing container $DB_CONTAINER"
    docker rm "$DB_CONTAINER" >/dev/null
    ok "Container removed (data volume $DB_VOLUME kept)"
  fi

  if [ "$PURGE_DATA" = true ]; then
    info "Deleting data volume $DB_VOLUME"
    if docker volume rm "$DB_VOLUME" >/dev/null 2>&1; then
      ok "Data volume deleted — the next ./start.sh begins with an empty database"
    else
      warn "Data volume $DB_VOLUME not found or still in use"
    fi
  fi
}

stop_app
stop_db

printf '\n'
ok "Down."
if [ "$PURGE_DATA" = false ]; then
  printf '     Database contents preserved. Start again with ./start.sh\n'
fi
