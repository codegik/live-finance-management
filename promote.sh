#!/usr/bin/env bash
#
# promote.sh — promote the code you validated on STAGING to PRODUCTION on Fly.io.
#
#   ./promote.sh
#
# Fly builds from source (there is no cross-app image copy here), so "promote"
# means: build the exact committed code currently checked out and deploy it to
# the production app (codegik-finance). The build is deterministic
# (pnpm install --frozen-lockfile against the committed lockfile).
#
# Guardrails:
#   • refuses a dirty working tree (so what ships matches a commit)
#   • asks for confirmation before touching production
#   • tags the released commit (release-<sha>)
#
# The web app's release_command runs `node migrate.mjs` before the new version
# serves traffic, and the daily reconcile machine is recreated on the new image.
# Production data lives in the prod Postgres, isolated from staging.
#
# The intended flow is ./deploy.sh (staging) → validate → ./promote.sh (prod).
#
# Requires: flyctl and jq on PATH, and a prior `fly auth login`.

set -euo pipefail
cd "$(dirname "$0")"          # repo root (this script lives here)

command -v fly >/dev/null 2>&1 || { echo "error: 'fly' (flyctl) not found on PATH." >&2; exit 1; }
command -v jq  >/dev/null 2>&1 || { echo "error: 'jq' not found on PATH (needed to manage the reconcile machine)." >&2; exit 1; }

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean. Commit or stash first so production" >&2
  echo "       matches a known commit." >&2
  exit 1
fi

log() { printf '\n==> %s\n' "$*"; }

APP="codegik-finance"
REGION="gru"
APP_URL="https://$APP.fly.dev"

COMMIT=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "About to PROMOTE to PRODUCTION:"
echo "    commit: $COMMIT ($BRANCH)"
echo "    $(git log -1 --pretty=%s)"
echo
echo "    Have you deployed and validated this commit on staging (./deploy.sh)?"
read -r -p "Proceed to production? [y/N] " ans
[[ "$ans" == [yY] || "$ans" == [yY][eE][sS] ]] || { echo "Aborted."; exit 1; }

# Build & deploy the web app. Migrations run in the release_command first.
log "Web → $APP"
fly deploy . -c fly/web.toml

# (Re)create the daily reconcile machine on the freshly-built image.
# shellcheck source=fly/reconcile.lib.sh
source fly/reconcile.lib.sh
ensure_reconcile_machine "$APP" "$REGION"

# Smoke test production (best-effort).
log "Smoke test: $APP_URL/signin"
code=""
for _ in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/signin" || true)
  [[ "$code" == "200" ]] && { echo "    OK (HTTP 200)"; break; }
  sleep 3
done
[[ "$code" == "200" ]] || echo "    NOTE: /signin returned ${code:-none}. Check 'fly logs -a $APP'." >&2

# Tag the released commit (best-effort — skip if it already exists).
TAG="release-$COMMIT"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "    (tag $TAG already exists — leaving it)"
else
  git tag -a "$TAG" -m "Promoted $COMMIT to production" && echo "    Tagged $TAG (push with: git push origin $TAG)"
fi

log "Promoted commit $COMMIT to PRODUCTION."
echo "    App: $APP_URL"
