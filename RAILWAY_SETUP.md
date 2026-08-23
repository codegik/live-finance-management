# Deploying to Railway

Three services in one Railway project, all from this repo:

| Service | What it is | Start command |
| --- | --- | --- |
| **web** | the Next.js app | `pnpm start` |
| **Postgres** | Railway's Postgres plugin | — |
| **reconcile** | the nightly sync, cron-scheduled | `pnpm reconcile` |

---

## Your webhook URL

Once the web service has a domain, point Pluggy at:

```
https://<your-app>.up.railway.app/api/webhooks/pluggy?token=<PLUGGY_WEBHOOK_TOKEN>
```

POST only. The secret is read from a query parameter literally named `token` and compared
in constant time against `PLUGGY_WEBHOOK_TOKEN`.

⚠️ **A query-string secret lands in access logs, proxy logs and referrer headers.** Pluggy's
own documentation recommends custom headers instead, and it is not confirmed that Pluggy
even preserves query strings on webhook delivery. Test this before relying on it — if
Pluggy strips the query string, webhook authentication does not merely weaken, it stops
working. The nightly reconcile is the backstop either way, so data still arrives.

---

## 1. Create the project

1. New Project → Deploy from GitHub repo → this repository.
2. Railway detects Next.js via Railpack and reads `railway.json` for the rest.

`railway.json` already sets the build command, start command, a `/signin` healthcheck, and
`preDeployCommand: ["pnpm db:migrate"]` — migrations run before each new container goes
live, in the right order, automatically. (This is the one thing Railway does better than
Vercel, which has no post-deploy hook at all.)

## 2. Add Postgres

Add a Postgres database to the project. Railway injects `DATABASE_URL` into services that
reference it — attach it to **both** the web service and the reconcile service.

The app uses the `postgres-js` driver against a normal connection, so the standard
`DATABASE_URL` is correct. No pooler-specific configuration is needed.

## 3. Environment variables

Every variable below is required. `loadEnv()` runs a strict parse and throws on the first
missing or malformed value, so a gap surfaces immediately and loudly rather than as a
mystery at 3am.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | injected by the Postgres plugin |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `PLUGGY_CLIENT_ID` | from the Pluggy dashboard (see `PLUGGY_SETUP.md`) |
| `PLUGGY_CLIENT_SECRET` | from the Pluggy dashboard |
| `PLUGGY_API_URL` | `https://api.pluggy.ai` |
| `PLUGGY_WEBHOOK_TOKEN` | `openssl rand -base64 32` |
| `CRON_SECRET` | `openssl rand -base64 32` |

**The reconcile service needs the same full set**, even though it only uses the database and
the Pluggy credentials — `loadEnv()` validates everything or nothing. Use Railway's shared
variables so both services read one definition instead of drifting apart.

## 4. The nightly reconcile

Create a **second service** from the same repo:

- Start command: `pnpm reconcile`
- Settings → **Cron Schedule**: `0 6 * * *`

Railway runs a cron service by executing its start command on schedule and expects the
process to exit. `reconcile-job.ts` does exactly that: it calls `reconcileAll` directly,
prints a summary, and exits 0 when every connection synced or 1 when any failed — so a
broken card shows as a failed run rather than a green one with bad news in the logs.

Two details worth knowing:

- **Schedules are UTC.** `0 6 * * *` is 03:00 in São Paulo, which is what the app wants.
- **Railway skips a run if the previous one is still going**, so a slow reconcile cannot
  pile up on itself.

Calling `reconcileAll` directly rather than posting to `/api/cron/reconcile` keeps the
shared secret out of the picture entirely and removes any request-timeout ceiling. The HTTP
route still exists for triggering a run by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.up.railway.app/api/cron/reconcile
```

## 5. Create your account — do this immediately

Visit `https://<your-app>.up.railway.app/setup` and create the first household.

**That page is open until you use it.** It renders only while the database has no household
and 404s permanently afterwards, so the window between the first successful deploy and your
visit is the one moment someone else could claim the app. Close it straight away rather than
leaving the deployment running overnight.

Do **not** run `./seed.sh` against production — its defaults (`owner@localhost` /
`localdev12345`) are deliberately fixed for local development and have no business on a
public URL.

## 6. Connect a card

With real Pluggy credentials set, sign in and use *Connect a card*. Transactions sync
immediately on connect; the nightly job keeps them current afterwards.

---

## What changed from Vercel

- `vercel.json` is gone; `railway.json` replaces it.
- `next start` is now a real start command — Railway runs a persistent server rather than
  serverless functions.
- `trustHost: true` is set in `lib/auth/session.ts`. Auth.js only auto-trusts the incoming
  Host header on Vercel; without this every request off-Vercel is rejected as
  `UntrustedHost`.
- The `maxDuration` export is gone from the cron route. There is no function timeout here,
  so the inline sync on connect and the nightly reconcile can take as long as they need —
  that whole class of worry disappears.
- Migrations moved from a manual pre-deploy step to `preDeployCommand`.
