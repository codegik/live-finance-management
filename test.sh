#!/usr/bin/env bash
#
# Run the full integration test suite.
#
# The tests do not use the dev database from ./start.sh. Vitest's global setup
# starts a throwaway Postgres via Testcontainers, migrates it, and stops it
# again in teardown — so the only dependency this script has to guarantee is a
# running Docker daemon. Any container the suite starts, the suite also stops;
# this script sweeps up only what an interrupted run leaves behind.
#
#   ./test.sh                          run everything
#   ./test.sh tests/webhook.test.ts    run one file
#   ./test.sh -t "redeem"              pass any vitest flag through

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

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

# Belt and braces: Vitest's teardown removes the test Postgres itself, so this
# only has work to do when a run was killed before teardown could execute.
#
# Ryuk is Testcontainers' own reaper. It lingers after every clean run by
# design and shuts itself down, so it is neither a sign of failure nor ours to
# kill — a concurrent run may still be relying on it.
#
# Note: this matches every container labelled by Testcontainers, so do not run
# two suites side by side on this machine.
sweep_test_containers() {
  local running stray
  running="$(docker ps --filter 'label=org.testcontainers=true' \
    --format '{{.ID}} {{.Image}}' 2>/dev/null \
    | grep -v 'testcontainers/ryuk' | awk '{print $1}' || true)"
  if [ -n "$running" ]; then
    warn "Stopping test containers left running by an interrupted run"
  fi
  stray="$(docker ps -a --filter 'label=org.testcontainers=true' \
    --format '{{.ID}} {{.Image}}' 2>/dev/null \
    | grep -v 'testcontainers/ryuk' | awk '{print $1}' || true)"
  if [ -n "$stray" ]; then
    # shellcheck disable=SC2086
    docker rm -f $stray >/dev/null 2>&1 || true
  fi
}

command -v docker >/dev/null 2>&1 || die "docker is not installed. See https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || die "The Docker daemon is not running. Start it and re-run (e.g. 'sudo systemctl start docker')."
command -v pnpm >/dev/null 2>&1 || die "pnpm is not installed. See https://pnpm.io/installation"
ok "Docker daemon available"

[ -d "$ROOT/node_modules" ] || { info "Installing dependencies"; (cd "$ROOT" && pnpm install --frozen-lockfile); }

trap sweep_test_containers EXIT INT TERM

info "Running integration tests (Testcontainers manages its own Postgres)"
cd "$ROOT"
set +e
pnpm vitest run "$@"
STATUS=$?
set -e

printf '\n'
if [ "$STATUS" -eq 0 ]; then
  ok "Tests passed. Test database stopped by Testcontainers teardown."
else
  warn "Tests failed (exit $STATUS)."
fi
exit "$STATUS"
