# Shared helper: (re)create the daily reconcile as a scheduled Fly machine.
#
# Sourced by ./deploy.sh (staging) and ./promote.sh (production). Not executable
# on its own.
#
# Why a scheduled machine and not fly.toml: Fly cannot express a cron schedule in
# a toml, and the built-in machine scheduler's finest grain is `daily`. The old
# Railway job ran twice daily (0 6,18 UTC); on Fly it runs once daily. That is an
# accepted trade-off — Pluggy webhooks keep transactions current in real time and
# the reconcile is only the backstop. For strict twice-daily, add an external
# cron (GitHub Actions / cron-job.org) that hits /api/cron/reconcile with the
# CRON_SECRET; the HTTP route exists for exactly that.
#
# The machine is pinned to the app's CURRENT image (the one `fly deploy` just
# built and released), named "reconcile", and destroyed+recreated on every deploy
# so it never runs stale code. It runs `node reconcile-job.mjs`, which calls
# reconcileAll directly and exits (0 = all synced, 1 = a connection failed).
# It inherits the app's secrets, so loadEnv() has everything it needs.

ensure_reconcile_machine() {
  local app="$1" region="$2"
  local ref

  # `fly image show --json` returns an ARRAY (one entry per machine, all the same
  # image), so take the first. Use the per-deployment TAG (unique per deploy):
  # passing a digest-pinned "repo@sha256:..." makes flyctl re-append the digest
  # and reject it as an invalid image identifier.
  ref=$(fly image show -a "$app" --json \
    | jq -r 'if length == 0 then "" else .[0] | "\(.Registry)/\(.Repository):\(.Tag)" end')
  if [[ -z "$ref" || "$ref" == "null"* || "$ref" == *":null" ]]; then
    echo "    WARN: could not resolve the current image for $app — skipping reconcile machine." >&2
    echo "          Re-run after the web deploy succeeds, or create it by hand (see fly/RUNBOOK.md)." >&2
    return 0
  fi

  printf '\n==> Reconcile → scheduled daily machine on %s\n' "$app"
  echo "    image: $ref"

  # Destroy any existing reconcile machine(s) so the new image takes effect.
  fly machine list -a "$app" --json 2>/dev/null \
    | jq -r '.[] | select(.name == "reconcile") | .id' \
    | while read -r id; do
        [[ -n "$id" ]] && { echo "    destroying old machine $id"; fly machine destroy --force "$id" -a "$app" >/dev/null; }
      done

  # restart=no: a batch job that exits; a failed run should show as failed, not
  # loop until the next schedule.
  if fly machine run "$ref" node reconcile-job.mjs \
    -a "$app" --name reconcile --schedule daily \
    --region "$region" --vm-memory 512 --restart no; then
    echo "    reconcile machine created (runs once daily)."
  else
    echo "    ERROR: failed to create the reconcile machine on $app." >&2
    echo "           The web app is deployed and fine; retry the reconcile with:" >&2
    echo "           source fly/reconcile.lib.sh && ensure_reconcile_machine $app $region" >&2
    return 1
  fi
}
