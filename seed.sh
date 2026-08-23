#!/usr/bin/env bash
#
# Create the first household and its owner, so you can actually sign in.
#
# Registration is invite-only: everyone else joins through an invite created by
# someone already signed in. Nothing creates the first account, so this does.
#
# Idempotent — an existing account is left untouched, so ./start.sh runs this
# on every boot. Changing a password is a separate, explicit act.
#
#   ./seed.sh                                    defaults (see below)
#   ./seed.sh you@example.com                    your email, default password
#   ./seed.sh you@example.com 'your password'    both
#   ./seed.sh --reset-password                   reset the default account's password
#   ./seed.sh you@example.com 'new pw' --reset-password
#
# Defaults are owner@localhost / localdev12345 — deliberately fixed and
# local-only, so the credentials are the same on every machine and every run.
# Never use them anywhere reachable from the internet.
#
# Requires the database to be up (./start.sh).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ENV_FILE="$ROOT/.env.local"

DEFAULT_EMAIL='owner@localhost'
DEFAULT_PASSWORD='localdev12345'

if [ -t 1 ]; then
  C_INFO=$'\033[0;36m'; C_OK=$'\033[0;32m'; C_WARN=$'\033[0;33m'
  C_ERR=$'\033[0;31m'; C_OFF=$'\033[0m'; C_BOLD=$'\033[1m'
else
  C_INFO=''; C_OK=''; C_WARN=''; C_ERR=''; C_OFF=''; C_BOLD=''
fi
info() { printf '%s==>%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s   !%s %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
die()  { printf '%sError:%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }

RESET=false
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --reset-password) RESET=true ;;
    -h | --help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "Unknown option: $arg (try --help)" ;;
    *) ARGS+=("$arg") ;;
  esac
done

[ -f "$ENV_FILE" ] || die "No .env.local. Run ./start.sh first."

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not set in .env.local"

SEED_EMAIL="${ARGS[0]:-${SEED_EMAIL:-$DEFAULT_EMAIL}}"
SEED_PASSWORD="${ARGS[1]:-${SEED_PASSWORD:-$DEFAULT_PASSWORD}}"
SEED_NAME="${SEED_NAME:-Owner}"
SEED_HOUSEHOLD="${SEED_HOUSEHOLD:-Home}"

command -v pnpm >/dev/null 2>&1 || die "pnpm is not installed."
[ -d "$ROOT/node_modules" ] || { info "Installing dependencies"; (cd "$ROOT" && pnpm install --frozen-lockfile); }

cd "$ROOT"
set +e
OUTPUT="$(
  SEED_EMAIL="$SEED_EMAIL" \
  SEED_PASSWORD="$SEED_PASSWORD" \
  SEED_NAME="$SEED_NAME" \
  SEED_HOUSEHOLD="$SEED_HOUSEHOLD" \
  SEED_RESET="$RESET" \
  DATABASE_URL="$DATABASE_URL" \
    pnpm exec tsx "$ROOT/seed.ts" 2>&1
)"
STATUS=$?
set -e

RESULT="$(printf '%s\n' "$OUTPUT" | sed -n 's/^seed-result: //p' | tail -1)"
printf '%s\n' "$OUTPUT" | grep -v '^seed-result: ' || true

if [ "$STATUS" -ne 0 ]; then
  die "Seeding failed. Is the database up? Try ./start.sh"
fi

printf '\n'
case "$RESULT" in
  exists)
    ok "Sign in at http://localhost:${APP_PORT:-3000}/signin as ${C_BOLD}${SEED_EMAIL}${C_OFF}"
    printf '     Password unchanged. Forgotten it? ./seed.sh --reset-password\n'
    ;;
  reset | created)
    [ "$RESULT" = reset ] && ok "Password reset." || ok "Household created."
    printf '     Sign in at http://localhost:%s/signin\n\n' "${APP_PORT:-3000}"
    printf '     %semail:%s     %s\n' "$C_BOLD" "$C_OFF" "$SEED_EMAIL"
    printf '     %spassword:%s  %s\n' "$C_BOLD" "$C_OFF" "$SEED_PASSWORD"
    ;;
  *)
    warn "Could not determine the seed result; check the output above."
    ;;
esac
