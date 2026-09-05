# Fly.io runbook — finance app

Migrates the stack off Railway. **One app + self-hosted Postgres** per
environment. There is no object storage (the app uses none). Run every
`fly deploy` **from the repository root** (the Dockerfile's build context is the
whole repo).

## Two environments

Two fully isolated environments — **staging** and **production** — each with its
own Fly app and Postgres cluster. Both serve on `*.fly.dev` (Fly auto-provisions
DNS + TLS, so **no external DNS setup** is needed unless you add a custom domain
to production later).

| Component  | production app         | staging app                    |
|------------|------------------------|--------------------------------|
| Web        | `codegik-finance`      | `codegik-finance-staging`      |
| Postgres   | `codegik-finance-db`   | `codegik-finance-db-staging`   |
| Reconcile  | `reconcile` machine on `codegik-finance` | `reconcile` machine on `codegik-finance-staging` |

**Daily flow:** `./deploy.sh` (build + ship the current commit to staging) →
validate at `codegik-finance-staging.fly.dev` → `./promote.sh` (clean-tree guard
+ confirm → ship the same commit to production + tag the release).

The Fly config is per-environment: `fly/web.toml` is production,
`fly/web.staging.toml` is staging (they differ only in the app name).
`bootstrap.sh` and `set-secrets.sh` take an environment arg
(`staging` | `production`, default `production`).

## How the pieces map from Railway

| Railway                                   | Fly                                               |
|-------------------------------------------|---------------------------------------------------|
| web service (`node server.js`)            | the app's default machine (same command)          |
| `preDeployCommand: node migrate.mjs`      | `[deploy] release_command = "node migrate.mjs"`   |
| reconcile service, cron `0 6,18 * * *`    | a scheduled `reconcile` machine, **daily** (see below) |
| Postgres plugin (`DATABASE_URL` injected) | `fly postgres` Flex + `fly postgres attach`       |
| shared env vars                           | `fly secrets` (one app → both web + reconcile)    |

### Reconcile schedule caveat

Fly's built-in machine scheduler's finest grain is `daily`, so the reconcile
runs **once a day** instead of Railway's twice. This is deliberate — Pluggy
webhooks keep transactions current in real time; the reconcile is only the
backstop. If you need strict twice-daily, add an external cron (GitHub Actions,
cron-job.org, …) hitting the existing HTTP route:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" https://codegik-finance.fly.dev/api/cron/reconcile
```

---

## 0. One-time setup (interactive — you run these)

```sh
curl -L https://fly.io/install.sh | sh      # install flyctl, add to PATH as it says
fly auth login                              # opens a browser
```

> Tip: in this Claude session, type `! fly auth login` in the prompt to run the
> interactive login so its output lands in the conversation.

Also install `jq` (the deploy scripts use it to manage the reconcile machine).

## 1. Provision infra (per environment — idempotent, safe to re-run)

```sh
bash fly/bootstrap.sh staging       # app + Postgres + attach (DATABASE_URL)
bash fly/bootstrap.sh production
```

This creates the app and a **self-hosted Fly Flex Postgres** (~$3–4/mo, NOT the
$38/mo managed `fly mpg`), then attaches it (which sets `DATABASE_URL` on the
app). The cost of self-hosting is that YOU own backups + major upgrades — see
§6.

## 2. Set the secrets (per environment)

Edit `fly/set-secrets.sh`, fill the Pluggy + Resend values (the openssl-generated
ones are created for you), then:

```sh
bash fly/set-secrets.sh staging
bash fly/set-secrets.sh production
```

`DATABASE_URL` is already set by the attach in step 1, so it is not in this
script. Every other var `loadEnv()` (lib/env.ts) requires is set here, and
`loadEnv` **rejects the public placeholders** from `.env.example`, so a copied
placeholder fails the boot loudly rather than at 3am.

Required set: `AUTH_SECRET`, `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`,
`PLUGGY_API_URL`, `PLUGGY_WEBHOOK_TOKEN`, `CRON_SECRET`, `RESEND_API_KEY`,
`ALERT_EMAIL_FROM` (+ `DATABASE_URL` from the attach).

## 3. Deploy

```sh
./deploy.sh      # → staging, then validate at codegik-finance-staging.fly.dev
./promote.sh     # → production (refuses a dirty tree, asks to confirm, tags release)
```

Each script: `fly deploy` (runs `node migrate.mjs` as the release_command first),
then recreates the daily `reconcile` machine on the just-built image, then
smoke-tests `/signin`. Watch logs with `fly logs -a codegik-finance`.

The raw command each script runs (trailing "." = repo root as build context;
the toml's dockerfile is `../Dockerfile`, relative to `fly/`):

```sh
fly deploy . -c fly/web.staging.toml     # staging
fly deploy . -c fly/web.toml             # production
```

## 4. Create your account — do this immediately

Visit `https://codegik-finance.fly.dev/setup` and create the first household.

**That page is open until you use it.** It renders only while the DB has no
household and 404s permanently afterwards, so the window between the first deploy
and your visit is the one moment someone else could claim the app. Do it straight
away. Do **not** run `./seed.sh` against production (its fixed
`owner@localhost` / `localdev12345` defaults have no business on a public URL).

## 5. Point Pluggy at the webhook

`set-secrets.sh` prints the URL. It is (POST only):

```
https://codegik-finance.fly.dev/api/webhooks/pluggy?token=<PLUGGY_WEBHOOK_TOKEN>
```

## 6. Postgres backups & upgrades (you own these on self-hosted Flex)

```sh
# Manual logical backup (run periodically or from a cron on your machine):
fly postgres connect -a codegik-finance-db          # psql shell
# or dump over the proxy:
fly proxy 5432 -a codegik-finance-db &
pg_dump "postgres://postgres:<pwd>@localhost:5432/codegik_finance" > backup.sql

# Fly also snapshots the volume daily by default; list/restore volume snapshots:
fly volumes list -a codegik-finance-db
fly volumes snapshots list <volume-id>
```

## 7. Common operations

```sh
fly logs -a codegik-finance                 # tail app logs
fly logs -a codegik-finance-db              # Postgres logs
fly machine list -a codegik-finance         # see web + reconcile machines
fly machine run <image> node reconcile-job.mjs -a codegik-finance --rm   # run reconcile now
fly secrets list -a codegik-finance         # names only (values are write-only)
fly status -a codegik-finance
```

## 8. Querying the production database (troubleshooting)

When a figure on screen looks wrong and you need to see the rows behind it, run
SQL directly against production. **Never copy the production `DATABASE_URL` to
your laptop** — the Postgres machine already has its own superuser password in
`$OPERATOR_PASSWORD`, so run `psql` *inside* the DB machine and the credential
never leaves it.

Ad-hoc one-liner (mind the shell quoting — `$OPERATOR_PASSWORD` is expanded on
the machine, so wrap the command in `sh -c` and keep it single-quoted locally):

```sh
fly ssh console -a codegik-finance-db \
  -C 'sh -c "psql postgres://postgres:$OPERATOR_PASSWORD@localhost:5432/codegik_finance -Atc \"select count(*) from transaction\""'
```

For anything non-trivial, write the SQL to a local file and **pipe it over
stdin** — this sidesteps all nested-quoting pain:

```sh
fly ssh console -a codegik-finance-db \
  -C 'sh -c "psql postgres://postgres:$OPERATOR_PASSWORD@localhost:5432/codegik_finance"' \
  < query.sql
```

Notes:
- Database is `codegik_finance`; staging is `codegik-finance-db-staging`.
- **Tables are singular** (`account`, `transaction`, `connection`, `budget`,
  `category`, `household`, `merchant_rule`, `user`) and columns are snake_case
  (`amount_cents`, `budget_month`, `budget_role`, `closing_day_override`, …).
  The Drizzle models in `lib/db/schema.ts` are the source of truth.
- A transaction's month on the dashboard is `coalesce(budget_month,
  date_trunc('month', date)::date)`, **not** `date` — a card purchase is filed
  in the month its fatura is *paid* (see `lib/domain/billing.ts`). Group by that
  expression to reconcile against the app.
- Read-only investigation needs no proxy. `fly proxy 15432:5432 -a
  codegik-finance-db` also works if you want a local `psql`/GUI, but then you
  need the password, which defeats the "credential stays on the machine" rule —
  prefer the `ssh console` form above.

## Cost sketch (minimum, cheap)

Per environment: 1 shared-cpu-1x/512MB web machine that suspends when idle +
1 shared-cpu-1x/512MB Postgres with a 1GB volume (~$3–4/mo) + a reconcile
machine that runs ~1 min/day (negligible). Staging suspends to near-zero when
you're not testing. Two environments ≈ the Postgres cost is the floor (~$7–8/mo).
