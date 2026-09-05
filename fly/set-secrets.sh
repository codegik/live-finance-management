#!/usr/bin/env bash
# Pushes the finance app's secrets to Fly for a given environment.
#
# Values live in a gitignored env file, NOT in this script:
#
#   fly/.env.production   fly/.env.staging
#
# Copy fly/.env.example to the one you need, fill in real values, then run:
#
#   bash fly/set-secrets.sh              # production (default)
#   bash fly/set-secrets.sh staging
#
# DATABASE_URL is NOT here — `fly postgres attach` (in bootstrap.sh) already set
# it on the app, and staging/production point at different clusters.
#
# loadEnv() (lib/env.ts) does a strict parse at startup and REJECTS the public
# placeholders from .env.example, so every value in the env file must be real.
#
# The same full set is required by BOTH the web machine and the daily reconcile
# machine — but they are the same Fly app, so importing once here covers both.
#
# AUTH_SECRET / CRON_SECRET / PLUGGY_WEBHOOK_TOKEN are stored in the env file so
# they stay STABLE across runs. Re-generating them would log everyone out and
# break the live webhook/cron URLs — generate them ONCE (see fly/.env.example)
# and leave them.
set -euo pipefail

ENVIRONMENT="${1:-production}"
case "$ENVIRONMENT" in
production) APP="codegik-finance" ;;
staging) APP="codegik-finance-staging" ;;
*)
  echo "usage: $0 [production|staging]" >&2
  exit 1
  ;;
esac

ENV_FILE="fly/.env.$ENVIRONMENT"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — copy fly/.env.example, fill it, then re-run." >&2
  exit 1
fi

echo "Importing secrets to: $APP  (from $ENV_FILE)"

# `fly secrets import` reads KEY=VALUE lines from stdin, so the env file is the
# single source of truth — no key list to keep in sync here.
fly secrets import --app "$APP" <"$ENV_FILE"

# Read a couple of values back purely to print the operational URLs.
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

echo
echo "Secrets imported to $APP."
echo "  Your Pluggy webhook URL (POST only):"
echo "    https://$APP.fly.dev/api/webhooks/pluggy?token=${PLUGGY_WEBHOOK_TOKEN:-<set PLUGGY_WEBHOOK_TOKEN>}"
echo "  Trigger a manual reconcile with:"
echo "    curl -H 'Authorization: Bearer ${CRON_SECRET:-<set CRON_SECRET>}' https://$APP.fly.dev/api/cron/reconcile"
