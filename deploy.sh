#!/usr/bin/env bash
#
# deploy.sh — build the current committed code and deploy it to the STAGING
# environment on Fly.io.
#
#   ./deploy.sh
#
# Staging is a full, isolated copy of production: its own Fly app
# (codegik-finance-staging) and its own Postgres (codegik-finance-db-staging).
# It is reachable at https://codegik-finance-staging.fly.dev and NEVER shares
# data with prod. Validate a change here, then ship it with ./promote.sh.
#
# `fly deploy` builds from the repo ROOT (the trailing "." is the build
# context); the toml's dockerfile path is "../Dockerfile", relative to fly/.
# The web app's release_command runs `node migrate.mjs` before the new version
# goes live, so the staging schema is applied to the staging DB on deploy.
#
# After the web deploy, the DAILY reconcile is (re)created as a scheduled Fly
# machine on the SAME app, pinned to the just-built image so it always runs the
# current code. (Fly cannot express a cron schedule in fly.toml.)
#
# One-time infra (staging app + DB + secrets) is provisioned by:
#   bash fly/bootstrap.sh staging
#   bash fly/set-secrets.sh staging
# See fly/RUNBOOK.md.
#
# Requires: flyctl and jq on PATH, and a prior `fly auth login`.

set -euo pipefail
cd "$(dirname "$0")"          # repo root (this script lives here)

command -v fly >/dev/null 2>&1 || { echo "error: 'fly' (flyctl) not found on PATH." >&2; exit 1; }
command -v jq  >/dev/null 2>&1 || { echo "error: 'jq' not found on PATH (needed to manage the reconcile machine)." >&2; exit 1; }

log() { printf '\n==> %s\n' "$*"; }

APP="codegik-finance-staging"
REGION="gru"
APP_URL="https://$APP.fly.dev"

COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "detached")
DIRTY=""
[[ -n "$(git status --porcelain 2>/dev/null)" ]] && DIRTY=" (dirty tree — uncommitted changes will be built)"

log "Deploying to STAGING — commit $COMMIT ($BRANCH)$DIRTY"

# Build & deploy the web app. Migrations run in the release_command first.
log "Web → $APP"
fly deploy . -c fly/web.staging.toml

# (Re)create the daily reconcile machine on the freshly-built image.
# shellcheck source=fly/reconcile.lib.sh
source fly/reconcile.lib.sh
ensure_reconcile_machine "$APP" "$REGION"

# Smoke test (best-effort; a suspended machine may cold-start).
log "Smoke test: $APP_URL/signin"
code=""
for _ in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/signin" || true)
  [[ "$code" == "200" ]] && { echo "    OK (HTTP 200)"; break; }
  sleep 3
done
[[ "$code" == "200" ]] || echo "    NOTE: /signin returned ${code:-none}. Check 'fly logs -a $APP'." >&2

log "Deployed commit $COMMIT to STAGING."
echo "    App: $APP_URL"
echo
echo "    Validate above, then promote this commit to production:"
echo "        ./promote.sh"
