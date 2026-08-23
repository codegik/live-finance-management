# Deploying to Vercel

Practical setup notes for this app (Next.js 15 App Router, React 19, Drizzle + PostgreSQL,
Auth.js v5, Pluggy). Everything below was checked against the code in this repo and against
Vercel's current docs (fetched 2026-08-22). Anything I could not confirm from an official
source is marked **⚠️ unverified**.

---

## TL;DR

| Question | Answer |
| --- | --- |
| Webhook URL | `https://<domain>/api/webhooks/pluggy?token=<PLUGGY_WEBHOOK_TOKEN>` — secret goes in the **`token` query parameter**, not a header |
| Cron plan tier | Cron is included on **all plans, Hobby included**. Hobby caps you at **once per day** with **±59 min** jitter. `0 6 * * *` is once per day, so it deploys on Hobby |
| `CRON_SECRET` | The route already matches Vercel's documented convention exactly (`Authorization: Bearer <CRON_SECRET>`). Just set an env var literally named `CRON_SECRET` |
| `maxDuration = 300` | Exactly the **Hobby ceiling** with Fluid compute (300 s default *and* max). Pro goes to 800 s. Without Fluid compute the Hobby ceiling is 60 s and the deploy fails |
| Missing before deploy | No `db:migrate` script, no way to create the first user, no Pluggy credentials |
| Recommendation | **Don't deploy to Vercel yet.** Use a tunnel for Pluggy webhooks during development. See [§7](#7-should-this-be-set-up-now) |

---

## 1. The Pluggy webhook URL

### The path

The route file is `app/api/webhooks/pluggy/route.ts`, and there are no route groups or
`src/` directory in the way, so the public path is exactly:

```
/api/webhooks/pluggy
```

It exports **`POST` only**. A `GET` to that path returns 405.

### How it authenticates — read this before writing the URL down

From `app/api/webhooks/pluggy/route.ts`:

```ts
const token = new URL(request.url).searchParams.get('token')
if (!tokenMatches(token, env.PLUGGY_WEBHOOK_TOKEN)) {
  return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
}
```

The shared secret arrives as a **query-string parameter named `token`**, compared against
`PLUGGY_WEBHOOK_TOKEN` with `timingSafeEqual`. There is **no header check**, no HMAC
signature check, and no `Authorization` parsing in this route. The comparison is
byte-exact — a trailing newline or URL-encoded padding will fail it.

> Because the secret lives in the URL it will appear in Vercel's runtime logs as part of
> the request path. That is acceptable for a household app but worth knowing.

### The URLs

**Production, custom domain** (what you should actually give Pluggy):

```
https://finance.example.com/api/webhooks/pluggy?token=YOUR_PLUGGY_WEBHOOK_TOKEN
```

**Production, Vercel-generated domain** (works, but ties the integration to Vercel's
hostname — fine for a first deploy):

```
https://<project-name>.vercel.app/api/webhooks/pluggy?token=YOUR_PLUGGY_WEBHOOK_TOKEN
```

**Preview deployments** — three differences, all of which bite:

1. **The hostname changes on every deployment.** Preview URLs look like
   `https://<project>-<hash>-<team-slug>.vercel.app`. There is a stable per-branch alias
   (`<project>-git-<branch>-<team>.vercel.app`), but it still is not the production host.
   You would have to re-register the webhook in Pluggy per branch.
2. **Preview deployments are protected by default-available Deployment Protection.**
   Vercel Authentication with *Standard Protection* covers "all deployments **except**
   production domains" and is available on every plan. If it is on, Pluggy's POST gets a
   Vercel login redirect, never your route. To let a webhook through, enable **Protection
   Bypass for Automation** and append the bypass secret as a query parameter — Vercel
   documents this exact case for third-party webhooks:

   ```
   https://<preview-host>/api/webhooks/pluggy?token=YOUR_TOKEN&x-vercel-protection-bypass=YOUR_BYPASS_SECRET
   ```
3. **Preview needs its own env vars.** `loadEnv()` parses *all seven* variables on every
   request into this route, so a preview deployment missing e.g. `CRON_SECRET` throws a
   500 before it ever looks at the token. See [§6](#6-environment-variables).

### Registering it with Pluggy

Nothing in this codebase sets a `webhookUrl`. `app/api/pluggy/connect-token/route.ts` calls
`pluggy.createConnectToken()` with no arguments, and `lib/pluggy/client.ts` posts
`{}` (or `{ itemId }`) to `/connect_token`. So the webhook must be registered
**at the client level** — in the Pluggy dashboard or via their create-webhook API — not
per-item.

Pluggy's docs are explicit that **HTTPS is required and localhost URLs are not allowed**
(they suggest ngrok for testing). This is the single reason a public deploy or tunnel is
needed at all.

### Two risks worth knowing before you commit to `?token=`

- **⚠️ unverified: Pluggy's docs do not state whether query-string parameters are preserved**
  on webhook delivery. Their documented mechanism for authenticating webhook calls is a
  custom **`headers` object** you configure on the webhook, not a URL token. If Pluggy
  normalizes the URL and drops the query string, every delivery 401s. Verify with a real
  test event before trusting it (see the smoke test below). If it turns out not to work,
  the fix is a small change in the route to also accept a header — but confirm first.
- **Pluggy expects a 2XX within 5 seconds** and retries up to 9 times (3 immediately,
  3 after 15 min, 3 after 2 h). This route does the *entire* sync inline —
  `syncByItemId` → `syncConnection` → Pluggy accounts + paginated transactions + DB
  writes — before responding. It will routinely blow past 5 s and get retried.
  The good news: the retries are safe. `lib/sync/transactions.ts` and `lib/sync/connect.ts`
  use `onConflictDoUpdate` against `transaction_pluggy_unique`, `account_pluggy_unique`
  and `connection_item_unique`, so re-delivery is idempotent. You will just burn duplicate
  compute. Worth revisiting later (respond 202 immediately, sync in the background).

### Smoke test after deploy

```bash
# Should return 401 (no token)
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://finance.example.com/api/webhooks/pluggy \
  -H 'content-type: application/json' -d '{"event":"item/updated","itemId":"x"}'

# Should return 202 {"ok":true,"ignored":true} for an unknown itemId — proves the
# token was accepted and the URL/query string survived the trip
curl -s -X POST \
  'https://finance.example.com/api/webhooks/pluggy?token=YOUR_PLUGGY_WEBHOOK_TOKEN' \
  -H 'content-type: application/json' -d '{"event":"item/updated","itemId":"not-a-real-item"}'
```

---

## 2. Vercel Cron

### Is `vercel.json` correct?

```json
{ "crons": [{ "path": "/api/cron/reconcile", "schedule": "0 6 * * *" }] }
```

Yes. The shape (`crons[].path` + `crons[].schedule`) is current, the path matches
`app/api/cron/reconcile/route.ts`, and the route exports `GET` — which is what Vercel
invokes ("Vercel makes an HTTP GET request to your project's production deployment URL").

Optional polish: add `"$schema": "https://openapi.vercel.sh/vercel.json"` for editor
validation. Not required.

### Plan tier

Cron jobs are **included in all plans**, Hobby included. The limits differ:

| | Cron jobs per project | Minimum interval | Scheduling precision |
| --- | --- | --- | --- |
| Hobby | 100 | **Once per day** | Per-hour (**±59 min**) |
| Pro | 100 | Once per minute | Per-minute |
| Enterprise | 100 | Once per minute | Per-minute |

`0 6 * * *` runs once per day, so **it deploys fine on Hobby**. Anything more frequent
(`0 * * * *`, `*/30 * * * *`) fails at deploy time on Hobby with
*"Hobby accounts are limited to daily cron jobs."*

Other Hobby/plan-independent facts that matter here:

- **Crons only hit the production deployment.** Preview deployments are never invoked.
- **No retries on failure.** The route returns 207 on partial failure and 500 when every
  connection failed; Vercel logs it and moves on. Nothing re-runs until tomorrow.
- **Delivery is best effort** — occasional missed runs *and* occasional duplicate runs.
  `reconcileAll` is a full re-sync with upserts, so duplicates are harmless here.
- **Instant Rollback does not update active crons.**

### `CRON_SECRET` — does this app match the convention?

Yes, precisely. Vercel's documented behaviour:

> It is possible to secure your cron job invocations by adding an environment variable
> called `CRON_SECRET` to your Vercel project. […] The value of the variable will be
> automatically sent as an `Authorization` header when Vercel invokes your cron job.
> […] The `authorization` header will have the `Bearer` prefix for the value.

And `app/api/cron/reconcile/route.ts`:

```ts
const b = Buffer.from(`Bearer ${expected}`)   // expected = env.CRON_SECRET
… authorizationMatches(request.headers.get('authorization'), env.CRON_SECRET)
```

So: **Vercel sets the `Authorization` header automatically**, but *only if* an environment
variable named exactly `CRON_SECRET` exists on the project. There is no separate toggle.
The env var must be present in the **Production** environment (that is where crons run).
Vercel recommends ≥16 characters; `lib/env.ts` enforces `.min(16)`, so the two agree.

Manual trigger for testing:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://finance.example.com/api/cron/reconcile
```

### The schedule vs. São Paulo

Vercel cron schedules are **always UTC** ("The timezone is always UTC"). São Paulo is
UTC−3 year-round (Brazil abolished DST in 2019), so:

- **`0 6 * * *` UTC = 03:00 America/Sao_Paulo.**
- On **Hobby**, expect it anywhere in **03:00–03:59 local** (06:00–06:59 UTC) because of
  the ±59 min jitter. On **Pro** it lands within the 03:00 minute.

03:00 local is a sensible slot for a nightly card reconcile. The comment in
`app/api/connections/route.ts` already refers to "the 03:00 cron", so code and config agree.

---

## 3. `maxDuration`

`app/api/cron/reconcile/route.ts` declares:

```ts
export const maxDuration = 300
```

With **Fluid compute** (enabled by default on new projects), Vercel's current limits for
the Node.js runtime:

| | Default | Maximum | Extended maximum |
| --- | --- | --- | --- |
| Hobby | 300 s | **300 s** | — |
| Pro | 300 s | **800 s** | 1800 s (beta, per-function config) |
| Enterprise | 300 s | 800 s | 1800 s (beta) |

So `300` is:

- **Exactly the Hobby ceiling** — legal, but with zero headroom. You cannot raise it
  without upgrading.
- Comfortably under the Pro ceiling of 800 s.
- Also the **default**, so on a Fluid-compute project the declaration changes nothing
  today. It becomes meaningful only if you later lower the project default in
  *Settings → Functions → Function Max Duration*, or move to Pro and want more.

**If the declared value exceeds the tier limit:** the **deployment fails at build time**
rather than being silently clamped. **⚠️ Partially verified** — Vercel's docs state the
limits but do not document the over-limit behaviour; the failure mode and the error text
(*"Serverless Functions must have a maxDuration between 1 and 60 for plan hobby"*) come
from community reports and issue threads, not official docs. The important corollary:

> **If Fluid compute is disabled on the project, the legacy Hobby ceiling is 60 s and
> `maxDuration = 300` will fail the deploy.** Fluid compute is on by default for new
> projects; if you import an older project or turn it off, either re-enable it or lower
> the value. ⚠️ The exact legacy (non-Fluid) numbers are no longer in the current docs
> pages I could fetch.

If a run *does* hit the ceiling, Vercel returns 504 `FUNCTION_INVOCATION_TIMEOUT` and the
work is simply lost until the next night — `reconcileAll` is not resumable.

**Is 300 s enough?** `lib/sync/reconcile.ts` loops connections **sequentially**, and each
`syncConnection` does a Pluggy item fetch, an accounts fetch, and paginated transactions
(up to 100 pages of 500). For a household with 2–5 cards this is seconds, not minutes.
It only becomes a problem if Pluggy is slow or an item is stuck syncing. Since each
connection is independent and failures are collected rather than thrown, a timeout mid-loop
loses only the un-processed tail — which the next night picks up.

---

## 4. Database

### What driver does this app use?

`lib/db/client.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
…
const sql = postgres(url, { max: 5 })
```

`postgres-js` over raw **TCP**. That means:

- ✅ **It works on Vercel's Node.js runtime.** No route in this app exports
  `runtime = 'edge'` (verified — the only route-segment config in `app/` is
  `maxDuration` on the cron route and `dynamic = 'force-dynamic'` on the ledger page),
  so everything runs on Node.js where TCP sockets are available.
- ❌ **It would not work on the Edge runtime.** If you ever add `runtime = 'edge'` to a
  route that touches the DB, you need an HTTP/WebSocket driver
  (`@neondatabase/serverless`, `postgres` over Supabase's REST, etc.) instead.
- ⚠️ **You still want a pooled connection string.** Serverless instances are created and
  destroyed independently and each one opens its own pool. `max: 5` per instance against a
  free-tier Postgres (which typically allows tens of connections) exhausts the server
  quickly under any concurrency, and Fluid compute keeps instances warm holding those
  connections open.

### Options

**Vercel Postgres no longer exists** — Vercel's own docs: *"Vercel Postgres is no longer
available. If you had an existing Vercel Postgres database, we automatically moved it to
Neon in December 2024. For new projects, install a Postgres integration from the
Marketplace."* Postgres on Vercel today means a Marketplace integration (Neon, Supabase,
Prisma Postgres, Nile, and others) that injects the connection env vars into your project.

| Option | Free tier (⚠️ third-party/marketing sources, verify at signup) | Notes for this app |
| --- | --- | --- |
| **Neon** (via Vercel Marketplace) | ~0.5 GB storage, ~100 CU-hours/month, scale-to-zero after 5 min idle | Best default. First-class Vercel integration, pooled endpoint (`-pooler` host), no inactivity-pause. Cold start after scale-to-zero adds latency to the first request |
| **Supabase** | ~500 MB database, 2 active projects, **projects pause after 7 days with no requests** | Fine, but the pause is a real hazard for a low-traffic household app. Use the **Supavisor transaction pooler on port 6543** for the app and port 5432 direct for migrations |
| **Any managed Postgres** (Railway, Fly, RDS, a VPS) | varies | Works, since the driver is plain TCP. You are responsible for pooling — put PgBouncer in front |

### Connection-string rules of thumb

- **App runtime → pooled endpoint.** Neon: the `…-pooler.…neon.tech` host. Supabase: port
  **6543** (Supavisor, transaction mode).
- **Migrations → direct endpoint** (port 5432 / non-pooler host). Transaction-mode poolers
  do not support the multi-statement DDL transactions migrations need. This means you will
  likely want two URLs, and `drizzle.config.ts` currently reads the same `DATABASE_URL`
  for both.
- **⚠️ If you use a transaction-mode pooler (Supabase 6543, PgBouncer), `postgres-js` needs
  `prepare: false`** or the second request to a warm instance fails with *"prepared
  statement already exists"*. This is a known, widely-reported combination — but it is a
  **code change in `lib/db/client.ts`** that this repo does not have yet. Neon's pooler is
  generally reported as tolerant of `postgres-js` defaults; test before assuming.
- Consider lowering `max: 5` to `1–2` for serverless, and setting `idle_timeout`.
  Again: a code change, listed in the gaps at the end, not made here.

### Region

Functions default to `iad1` (Washington, D.C.). Your database and your users are in Brazil.
Put both in the same place — Vercel has a São Paulo region (`gru1`) — or every query pays a
~200 ms round trip. Set it in *Settings → Functions → Function Region*.
**⚠️ Region availability per plan is not something I verified**; Hobby is limited to a
single region, and multi-region is Pro/Enterprise.

---

## 5. Migrations on deploy

### Current state

`package.json` has `db:generate` (`drizzle-kit generate`) and **no migrate script at all**.
`drizzle/` holds 5 SQL migrations (`0000_household` … `0004_transaction`) with a valid
`meta/_journal.json`. `drizzle.config.ts` reads `process.env.DATABASE_URL`. So the SQL
exists; nothing applies it.

`drizzle-kit` is a **devDependency**, which is fine — Vercel installs devDependencies
during the build.

### Recommended: apply migrations from your machine, not from the build

For a single-household app with one deployer, the lowest-risk approach is an explicit,
supervised step:

```jsonc
// package.json — add:
"db:migrate": "drizzle-kit migrate"
```

```bash
# run before deploying, against the DIRECT (non-pooled) URL
DATABASE_URL='postgres://…direct…:5432/db' pnpm db:migrate
```

You see the output, you control the ordering, and a bad migration never takes the deploy
with it.

### Alternative: run it in the build command

If you want it automatic, override the build command in
*Settings → Build & Development Settings → Build Command*:

```
pnpm db:migrate && pnpm build
```

(or set `"build": "drizzle-kit migrate && next build"` in `package.json`, which also
affects local builds — prefer the dashboard override.)

Caveats, all of which apply here:

- `DATABASE_URL` must be available at **build** time, not just runtime — env vars in Vercel
  are available to builds by default, but confirm the variable is enabled for the
  environment being built.
- Use the **direct** connection string for migrations. If `DATABASE_URL` points at a
  transaction pooler, migrations may fail. This likely means a second var
  (`DIRECT_DATABASE_URL`) plus a `drizzle.config.ts` change — **not done here**.
- **Preview builds would also migrate.** If previews share the production database, a
  branch build mutates production schema. Either give previews their own database (Neon
  branching is good at this) or keep migrations out of the build.
- Vercel builds are not serialized — two concurrent deploys could run `migrate` at the
  same time. Drizzle's `__drizzle_migrations` table makes this mostly safe, but it is
  another argument for the manual approach.

There is **no post-deploy hook** on Vercel that runs after the deployment goes live, so
"migrate then deploy" is genuinely the only ordering available in-platform.

---

## 6. Environment variables

Every variable in `lib/env.ts`. Note `loadEnv()` runs a strict Zod parse on **every request
into every API route** — a single missing or malformed value produces a runtime 500, not a
build failure. Set all of them in **every environment you actually use**.

| Variable | Required | Where it comes from | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | Your Postgres provider | Must parse as a URL. Use the **pooled** endpoint for runtime. Injected automatically by a Marketplace integration |
| `AUTH_SECRET` | yes, ≥16 chars | You generate it | `openssl rand -base64 32`. See the note below about preview vs production |
| `PLUGGY_CLIENT_ID` | yes | Pluggy dashboard | Not a secret per se, but treat it as one |
| `PLUGGY_CLIENT_SECRET` | yes | Pluggy dashboard | Secret. Production and sandbox credentials differ |
| `PLUGGY_API_URL` | no (defaults to `https://api.pluggy.ai`) | Pluggy | Only set it to point at a sandbox/mock. **Zod applies the default only when the key is absent** — do not set it to an empty string |
| `PLUGGY_WEBHOOK_TOKEN` | yes, ≥16 chars | You generate it | `openssl rand -base64 32`. This is the `?token=` value in the webhook URL. Avoid `+` and `/` in the value or URL-encode carefully — pick a URL-safe generator, e.g. `openssl rand -hex 32` |
| `CRON_SECRET` | yes, ≥16 chars | You generate it | **Name is load-bearing** — Vercel only auto-sends the `Authorization` header for a var with exactly this name |

Generate all three secrets:

```bash
openssl rand -hex 32   # AUTH_SECRET
openssl rand -hex 32   # PLUGGY_WEBHOOK_TOKEN
openssl rand -hex 32   # CRON_SECRET
```

### Auth.js v5 on Vercel: what you do *not* need

Verified against Auth.js deployment docs:

- **`AUTH_URL` is not needed on Vercel** — *"mostly unnecessary with v5 as the host is
  inferred from the request headers."*
- **`NEXTAUTH_URL` is not needed either.** It is the v4 name; this app is on
  `next-auth@5.0.0-beta.32` and never reads it.
- **`AUTH_TRUST_HOST` is not needed on Vercel** — Auth.js infers it from the `VERCEL`
  environment variable that Vercel sets automatically. (You *would* need it on a
  non-detected host, e.g. a self-hosted container.)
- `lib/auth/session.ts` does not set `trustHost` explicitly, which is correct for Vercel.

### Preview vs production

- **`AUTH_SECRET` should be the same value across preview and production.** Auth.js docs:
  *"To support preview deployments, the `AUTH_SECRET` value needs to be the same for the
  stable deployment and deployments that will need OAuth support."* This app uses only the
  Credentials provider with a JWT session, so the OAuth redirect-proxy reason does not
  apply — but keeping it identical costs nothing and avoids surprise sign-outs when
  hopping between preview URLs. If you prefer strict isolation, a different value is safe
  here; it just invalidates sessions across environments.
- **Everything else should differ**, in particular `DATABASE_URL` (previews should not
  write to the household's real ledger) and ideally the Pluggy credentials (sandbox for
  preview, production for production).
- `CRON_SECRET` only matters in Production — crons never run against previews — but
  `loadEnv()` demands it everywhere, so set a value in Preview too or every preview API
  request 500s.
- Sessions are JWT (`session: { strategy: 'jwt' }`), so cookies are host-scoped and preview
  URLs each get their own login. Expected, not a bug.

---

## 7. Should this be set up now?

**Recommendation: no — not the Vercel deploy. Use a tunnel for development instead, and
deploy once two blockers are cleared.**

### Why deploying today produces a dead site

1. **There is no way to create the first user.** `lib/db/households.ts` exports
   `createHousehold`, but nothing calls it — there is no seed script, no bootstrap route,
   no CLI. The only registration path is `/join/[token]`, which needs an invite; invites
   come from `POST /api/household/invites`, which is behind `requireSessionOrResponse()`;
   a session needs a user; a user needs a household. It is a closed loop. A deployed
   production app would be a sign-in page nobody can get past, and you would be reduced to
   `INSERT`ing a bcrypt hash by hand against production.
2. **The Pluggy credentials do not exist yet.** Without `PLUGGY_CLIENT_ID` /
   `PLUGGY_CLIENT_SECRET`, `loadEnv()` throws and **every API route returns 500** — the
   ledger page, the connect flow, the webhook, the cron. You cannot even deploy a
   "shell" version usefully; the env schema is all-or-nothing.
3. **Nothing about the deploy is reversible-cheap in the wrong order.** You would set up a
   database, run migrations by hand, wire seven env vars, and then still be blocked on
   both of the above.

### The one real argument for deploying early — and why a tunnel answers it

The argument is sound: **Pluggy requires an HTTPS URL and explicitly rejects localhost**,
so a laptop cannot receive webhooks. But that does not require Vercel.

A tunnel gives you the same public HTTPS URL pointing at your local `next dev`, with a
much faster loop (edit → save → the *next* webhook hits the new code, no deploy):

```bash
# cloudflared — free, and a *named* tunnel gives you a stable hostname
cloudflared tunnel --url http://localhost:3000
# → https://random-words-1234.trycloudflare.com

# then register with Pluggy:
# https://random-words-1234.trycloudflare.com/api/webhooks/pluggy?token=<PLUGGY_WEBHOOK_TOKEN>
```

Either tool works. The one thing to plan for: **ngrok's free URLs and cloudflared's
quick-tunnel URLs rotate on every restart**, so you must re-register the webhook in Pluggy
each session. A cloudflared *named* tunnel (or a paid ngrok static domain) gives you one
stable hostname and removes that chore — worth the 10 minutes of setup if you will be
iterating on the webhook for more than a day.

A tunnel also lets you verify the thing I flagged as unverified in §1: whether Pluggy
actually preserves the `?token=` query string. Find that out against localhost, where the
fix is free, rather than against production.

What a tunnel does **not** give you: the nightly cron. Vercel Cron only fires against a
production deployment. That is fine — the reconcile route is a plain `GET`, so you can
exercise it locally with a `curl` and a `Bearer` header, and there is no rush to have a
real 03:00 job before the app has any data in it.

### The order I would actually do it in

1. **Add a bootstrap path for the first user** — a seed script calling `createHousehold`,
   or a one-shot setup route. Without it nothing else matters.
2. **Get Pluggy sandbox credentials**, fill `.env.local`, and confirm the connect flow and
   the webhook work end-to-end over a tunnel.
3. **Add `db:migrate`** to `package.json` and apply migrations to a hosted database from
   your machine.
4. **Then deploy to Vercel** on Hobby: import the repo, set the seven env vars in
   Production, verify the build succeeds (it will exercise the `maxDuration = 300` check),
   confirm the cron appears under *Settings → Cron Jobs*.
5. **Add a custom domain**, then re-point the Pluggy webhook at the production URL and
   send a test event.
6. Revisit Pro only if you want the cron to fire at a precise 03:00 rather than somewhere
   in the 03:00 hour, or if reconcile needs more than 300 s.

None of steps 1–3 are made easier by having deployed first.

---

## Appendix: gaps found in the repo (not fixed by this document)

These are things a Vercel deploy will surface. Listing them, not changing them:

- **No `db:migrate` script** in `package.json` (§5).
- **No first-user bootstrap** — `createHousehold` has no caller outside tests (§7).
- **The webhook syncs inline** and will exceed Pluggy's 5-second expectation, causing
  retries. Harmless (upserts are idempotent) but wasteful (§1).
- **`postgres(url, { max: 5 })`** in `lib/db/client.ts` is high for serverless, and there
  is no `prepare: false` — required if you land on a transaction-mode pooler (§4).
- **`drizzle.config.ts` uses one `DATABASE_URL`** for both runtime and migrations, which
  conflicts with the pooled-vs-direct split most providers want (§4, §5).
- **`vercel.json` has no `$schema`** — cosmetic.

## Verification notes

Confirmed against official docs (fetched 2026-08-22): cron plan tiers and the Hobby
once-per-day / ±59 min limits; the `CRON_SECRET` `Authorization: Bearer` convention; cron
schedules always being UTC and only hitting production; `maxDuration` limits per plan under
Fluid compute (Hobby 300/300, Pro 300/800/1800); Deployment Protection scopes and the
`x-vercel-protection-bypass` header/query bypass; Vercel Postgres's retirement into the
Marketplace; Auth.js v5's `AUTH_URL`/`AUTH_TRUST_HOST`/`AUTH_SECRET` behaviour on Vercel;
Pluggy's HTTPS-only webhooks, 5-second/2XX expectation and retry schedule.

Marked **⚠️ unverified** above: the exact failure behaviour and error text when
`maxDuration` exceeds a plan limit (community-sourced); the legacy non-Fluid-compute
duration ceilings; whether Pluggy preserves webhook URL query strings; Neon and Supabase
free-tier numbers (third-party summaries, not the providers' own pages); whether
`postgres-js` needs `prepare: false` against Neon's pooler specifically; Vercel function
region availability per plan.
