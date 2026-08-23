#!/usr/bin/env bash
#
# Start the local Postgres container and the Next.js dev server.
# Safe to re-run: anything already running is left alone.
#
#   ./start.sh                 start everything
#   APP_PORT=3001 ./start.sh   use a different app port
#   DB_PORT=5433 ./start.sh    use a different database port

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

DB_CONTAINER="${DB_CONTAINER:-finance-db}"
DB_VOLUME="${DB_VOLUME:-finance-db-data}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-finance}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-password}"
# Same image the integration tests use, so local dev and tests agree.
DB_IMAGE="${DB_IMAGE:-postgres:16-alpine}"
APP_PORT="${APP_PORT:-3000}"

PID_FILE="$ROOT/.dev-server.pid"
LOG_FILE="$ROOT/.dev-server.log"
ENV_FILE="$ROOT/.env.local"

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

# Prints the dev server pid and returns 0 only when it is genuinely alive.
app_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

ensure_env_file() {
  if [ -f "$ENV_FILE" ]; then
    ok ".env.local present"
    return
  fi

  command -v openssl >/dev/null 2>&1 \
    || die "openssl is needed to generate secrets. Copy .env.example to .env.local and fill it in by hand."

  info "Creating .env.local (first run)"
  cat >"$ENV_FILE" <<ENVEOF
DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}
AUTH_SECRET=$(openssl rand -base64 32)
PLUGGY_CLIENT_ID=replace-with-your-pluggy-client-id
PLUGGY_CLIENT_SECRET=replace-with-your-pluggy-client-secret
PLUGGY_API_URL=https://api.pluggy.ai
PLUGGY_WEBHOOK_TOKEN=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -base64 32)
ENVEOF
  chmod 600 "$ENV_FILE"
  ok "Generated .env.local with fresh secrets"
  warn "PLUGGY_CLIENT_ID and PLUGGY_CLIENT_SECRET are placeholders."
  warn "The app runs, but connecting a card fails until you set real values."
}

start_db() {
  case "$(container_state)" in
    running)
      ok "Postgres already running (container $DB_CONTAINER)"
      return
      ;;
    exited | created | paused)
      info "Starting existing Postgres container"
      docker start "$DB_CONTAINER" >/dev/null
      ;;
    missing)
      info "Creating Postgres container ($DB_IMAGE, port $DB_PORT)"
      local err
      err="$(mktemp)"
      if ! docker run -d \
        --name "$DB_CONTAINER" \
        -e POSTGRES_USER="$DB_USER" \
        -e POSTGRES_PASSWORD="$DB_PASSWORD" \
        -e POSTGRES_DB="$DB_NAME" \
        -p "${DB_PORT}:5432" \
        -v "${DB_VOLUME}:/var/lib/postgresql/data" \
        "$DB_IMAGE" >/dev/null 2>"$err"; then
        warn "$(cat "$err")"
        rm -f "$err"
        die "Could not start Postgres. If port $DB_PORT is taken, re-run with: DB_PORT=5433 ./start.sh"
      fi
      rm -f "$err"
      ;;
  esac

  info "Waiting for Postgres to accept connections"
  local i=0
  while [ "$i" -lt 60 ]; do
    if docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
      ok "Postgres ready on localhost:$DB_PORT"
      return
    fi
    i=$((i + 1))
    sleep 1
  done
  die "Postgres did not become ready. Check: docker logs $DB_CONTAINER"
}

run_migrations() {
  info "Applying migrations"
  # drizzle-kit does not read .env.local the way Next.js does.
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  (cd "$ROOT" && pnpm drizzle-kit migrate >/dev/null) \
    || die "Migrations failed. Run 'pnpm drizzle-kit migrate' to see the error."
  ok "Schema up to date"
}

start_app() {
  local pid
  if pid="$(app_pid)"; then
    ok "Dev server already running (pid $pid) at http://localhost:$APP_PORT"
    return
  fi
  rm -f "$PID_FILE"

  info "Starting Next.js dev server"
  cd "$ROOT"
  # setsid puts the server in its own process group so stop.sh can signal the
  # whole tree; pnpm's child would otherwise outlive a kill on the parent.
  if command -v setsid >/dev/null 2>&1; then
    setsid pnpm next dev --port "$APP_PORT" >"$LOG_FILE" 2>&1 </dev/null &
  else
    pnpm next dev --port "$APP_PORT" >"$LOG_FILE" 2>&1 </dev/null &
  fi
  pid=$!
  echo "$pid" >"$PID_FILE"

  local i=0
  while [ "$i" -lt 90 ]; do
    if curl -sf -o /dev/null "http://localhost:$APP_PORT/signin" 2>/dev/null; then
      ok "Dev server ready at http://localhost:$APP_PORT (pid $pid)"
      return
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      warn "Last 20 lines of $LOG_FILE:"
      tail -20 "$LOG_FILE" >&2 || true
      die "The dev server exited during startup."
    fi
    i=$((i + 1))
    sleep 1
  done

  warn "Dev server did not answer within 90s; it may still be compiling."
  warn "Follow it with: tail -f $LOG_FILE"
}

command -v docker >/dev/null 2>&1 || die "docker is not installed. See https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || die "The Docker daemon is not running. Start it and re-run (e.g. 'sudo systemctl start docker')."
command -v pnpm >/dev/null 2>&1 || die "pnpm is not installed. See https://pnpm.io/installation"

seed_household() {
  # Registration is invite-only and nothing creates the first account, so
  # without this there is no way to sign in. ./seed.sh is idempotent: an
  # existing account is left untouched, so this is safe on every boot.
  if [ "${SEED_SKIP:-false}" = true ]; then
    ok "Skipping seed (SEED_SKIP=true)"
    return
  fi
  info "Seeding the first household"
  # A seeding failure should not take the whole stack down — the app and
  # database are already up and usable at this point.
  "$ROOT/seed.sh" || warn "Seeding failed. Run ./seed.sh on its own to see why."
}

ensure_env_file
[ -d "$ROOT/node_modules" ] || { info "Installing dependencies"; (cd "$ROOT" && pnpm install --frozen-lockfile); }
start_db
run_migrations
start_app
printf '\n'
seed_household

printf '\n'
ok "Up. http://localhost:$APP_PORT"
printf '     logs:  tail -f %s\n' "$LOG_FILE"
printf '     stop:  ./stop.sh\n'
