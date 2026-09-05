#!/usr/bin/env bash
# Idempotent Fly.io bootstrap for the finance app — the reproducible source of
# truth for infra the fly.toml can't express (the app and its Postgres). Safe to
# re-run: every step checks-then-creates, so a second run converges instead of
# erroring.
#
#   bash fly/bootstrap.sh                # production (default)
#   bash fly/bootstrap.sh production
#   bash fly/bootstrap.sh staging        # full isolated staging copy
#
# staging and production are fully separate: their own app and Postgres cluster.
# staging uses a *.fly.dev hostname (Fly auto-provisions DNS + TLS), so it needs
# NO custom domain / DNS setup.
#
# There is NO object storage here (the finance app uses none) and NO reconcile
# machine (that is created per-deploy by deploy.sh / promote.sh, so it always
# runs the freshly-built image).
#
# Prereqs: flyctl installed and `fly auth login` done. Run from the repo ROOT.
# Secret VALUES are NOT set here — fill and run fly/set-secrets.sh separately.
set -euo pipefail

ENVIRONMENT="${1:-production}"
case "$ENVIRONMENT" in
  production) SUFFIX="" ;;
  staging)    SUFFIX="-staging" ;;
  *) echo "usage: $0 [production|staging]" >&2; exit 1 ;;
esac

# ── Config ──────────────────────────────────────────────────────────────────
ORG="personal"
REGION="gru"                       # São Paulo
PG_VM_MEMORY="512"                 # MB for the Postgres machine (shared-cpu-1x)
PG_VOLUME_GB="1"                   # small — a household ledger is tiny

WEB_APP="codegik-finance${SUFFIX}"
DB_NAME="codegik-finance-db${SUFFIX}"

# Custom domains are optional and PRODUCTION-ONLY. Leave empty to serve prod on
# codegik-finance.fly.dev too; add "host=app" pairs here to provision certs.
declare -A DOMAINS=()
# if [[ "$ENVIRONMENT" == "production" ]]; then
#   DOMAINS=( ["finance.example.com"]="$WEB_APP" )
# fi
# ────────────────────────────────────────────────────────────────────────────

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
command -v fly >/dev/null || { echo "flyctl not on PATH"; exit 1; }
command -v jq  >/dev/null || { echo "jq not on PATH"; exit 1; }

echo "Bootstrapping environment: $ENVIRONMENT  (app suffix '${SUFFIX:-<none>}')"

# Exact-name match. Do NOT use `grep -w`: grep treats '-' as a word boundary, so
# "codegik-finance-db" would spuriously match "codegik-finance-db-staging" and the
# script would skip creating an app that doesn't exist.
app_exists() { fly apps list --json 2>/dev/null | jq -e --arg n "$1" 'any(.[]; .Name == $n)' >/dev/null; }
ensure_app() { if app_exists "$1"; then echo "  app $1 ✓"; else log "Creating app $1"; fly apps create "$1" --org "$ORG"; fi; }

log "1/3 App"
ensure_app "$WEB_APP"

log "2/3 Postgres — self-hosted Fly Flex ($DB_NAME, ${PG_VM_MEMORY}MB, ${PG_VOLUME_GB}GB)"
# NB: deliberately `fly postgres` (self-hosted Flex, ~\$3-4/mo), NOT `fly mpg`
# (Managed Postgres, ~\$38/mo). Trade-off: we own backups + major upgrades.
if app_exists "$DB_NAME"; then
  echo "  cluster app $DB_NAME ✓ (skipping create)"
else
  fly postgres create --name "$DB_NAME" --org "$ORG" --region "$REGION" \
    --initial-cluster-size 1 --vm-size shared-cpu-1x \
    --vm-memory "$PG_VM_MEMORY" --volume-size "$PG_VOLUME_GB"
fi
# Attach → creates a db + user and sets DATABASE_URL on the web app (a direct
# connection, no pgbouncer). The postgres-js driver the app uses wants exactly
# this. Guard on the secret so re-runs don't error.
if fly secrets list -a "$WEB_APP" 2>/dev/null | grep -qw DATABASE_URL; then
  echo "  DATABASE_URL already set on $WEB_APP ✓"
else
  log "Attaching $DB_NAME → $WEB_APP"
  fly postgres attach "$DB_NAME" --app "$WEB_APP"
fi

if [[ ${#DOMAINS[@]} -eq 0 ]]; then
  log "3/3 Certificates — skipped ($ENVIRONMENT serves on *.fly.dev)"
else
  log "3/3 Certificates (creates the cert + prints DNS records to add at your DNS provider)"
  for host in "${!DOMAINS[@]}"; do
    app="${DOMAINS[$host]}"
    if fly certs list -a "$app" 2>/dev/null | grep -qw "$host"; then
      echo "  cert $host ($app) ✓"
    else
      log "Adding cert $host → $app"
      fly certs add "$host" -a "$app" || echo "  (cert add for $host completes once DNS points at Fly)"
    fi
  done
fi

log "Next steps"
cat <<EOF
  • Set the app secrets (needs YOUR values):
        bash fly/set-secrets.sh $ENVIRONMENT
  • Deploy:
        $( [[ "$ENVIRONMENT" == "staging" ]] && echo "./deploy.sh    # → staging" || echo "./promote.sh   # → production" )
  • First run only — create the household immediately at:
        https://${WEB_APP}.fly.dev/setup   (that page 404s forever once used)
EOF
log "bootstrap complete ($ENVIRONMENT)"
