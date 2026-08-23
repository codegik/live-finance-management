# Alerts (Slice 5) — Design

**Date:** 2026-08-23
**Status:** Approved for planning

**Parent spec:** `docs/superpowers/specs/2026-08-22-live-finance-management-design.md`
**Predecessor specs:** `docs/superpowers/specs/2026-08-23-categorization-design.md`,
`docs/superpowers/specs/2026-08-23-budgets-design.md`

## Problem

The dashboard answers *how much have we spent on supermarket this month, and
is that within budget* — but only when someone opens it. Slice 3 made the
number correct; it did not make it arrive. A budget that is only consulted
deliberately is consulted after the money is gone.

## Goals

- A category crossing 80% or 100% of its monthly budget notifies the
  household by email, within minutes of the transaction posting.
- A crossing notifies **once**, not on every subsequent sync.
- The fired state re-arms when the underlying numbers genuinely change — a
  raised budget, a recategorization, an estorno — so a later crossing fires
  again.
- Several crossings in one sync arrive as one message, not several.

## Non-goals

- The uncategorized nudge. Deferred: the dashboard already shows an
  uncategorized count and amount, and a nightly "you have N uncategorized"
  mail is the version most likely to be filtered within a week. Revisit if
  the badge proves insufficient.
- Pace-based alerts. Thresholds fire on posted spend only. Pace is a
  projection, and a projection that misfires is what teaches a household to
  mute the channel.
- Alert preferences of any kind — no per-user opt-out, no per-category mute,
  no settings screen. Two users, both receive everything.
- Web push, SMS, WhatsApp.
- In-app alert history. `alert_state` is machinery, not a screen.

## Decisions

| Question | Decision |
|---|---|
| Channel | Email via Resend, to every user in the household |
| Trigger | Posted, non-transfer spend crossing 80% / 100% of the category budget |
| Timing | After every sync — webhook and nightly reconcile alike |
| Batching | One message per evaluation, listing every threshold crossed |
| Dedupe | `alert_state` row per (household, category, month, threshold) |
| Re-arm | Derived at evaluation, never invalidated by callers |
| Recipients | All household users; nothing configurable |
| Uncategorized nudge | Deferred out of this slice |

## Approach: re-arm is derived, not invalidated

The parent spec requires that fired state "resets when the underlying numbers
change." Two ways to honour that:

**Explicit invalidation** — the budget editor and the recategorize pass delete
the affected `alert_state` rows when they write. Direct to read at the call
site, and wrong: every future code path that moves spend or budget has to
remember, and forgetting is silent. The category simply never alerts again
that month, and nothing fails.

**Derived re-arm** — every evaluation recomputes spend and budget from
scratch, compares against the rows that exist, and both fires *and clears*
from that one comparison. Raising a budget re-arms because the ratio drops.
Recategorizing out of Supermercado re-arms because its spend drops. An
estorno, a deleted transaction, an archived category, and every case nobody
enumerated are handled by the same rule, because the rule reads the world
rather than being told about it.

This design takes derived re-arm. It costs one extra `delete` per evaluation.
Nothing outside `lib/alerts/` knows alerts exist.

The project has made this call before: `resolveBudget` resolves carry-forward
at read time rather than writing future rows, for the same reason — one
implementation of a rule cannot drift from another.

## Data model

`alert_state`, in migration `0007_alerts.sql`, shaped to match `budget` so the
two sort and join alike:

```
id            uuid pk
household_id  uuid not null → household(id) on delete cascade
category_id   uuid not null → category(id)  on delete cascade
period_month  date not null                 -- always the first of the month
threshold     integer not null              -- a percent: 80 or 100
fired_at      timestamptz not null default now()

unique index alert_state_unique on (household_id, category_id, period_month, threshold)
```

`threshold` is an integer percent rather than an enum, so adding 50% later
costs no migration.

No `spent_cents` / `budget_cents` snapshot is stored. Under derived re-arm
every decision is recomputed from the live rows, so a stored copy could only
ever be a second version of the truth that disagrees with the first.

## Module boundaries

Dependency arrows point inward only, as elsewhere in the codebase.

- **`lib/domain/alerts.ts`** — pure, no I/O. `evaluateAlerts({ rows, fired })`
  returning `{ toFire, toClear }`, where a row is
  `{ categoryId, categoryName, spentCents, budgetCents: number | null }` and
  `fired` is the existing `(categoryId, threshold)` pairs for the month. The
  entire fire-and-re-arm rule, in one function, assertable directly.
- **`lib/db/alerts.ts`** — `listFiredAlerts`, `recordFired`, `clearFired`.
  Household scoping lives here, never at the call site.
- **`lib/email/`** — the only module aware that Resend exists, mirroring
  `lib/pluggy/`. `createMailer({ apiKey, from })` returning
  `{ send({ to, subject, text }) }` over plain `fetch`, plus a pure
  `renderAlertEmail(...)`. Replacing Resend rewrites this directory and
  nothing else. No new npm dependency: `fetch` against
  `https://api.resend.com/emails`, exactly as `lib/pluggy/client.ts` works.
- **`lib/alerts/evaluate.ts`** — orchestration. Reads spend, calls the pure
  evaluator, sends, persists. Depends on the three above; nothing depends on
  it except the two sync entry points.

### One change to existing code

The per-category spend aggregate is currently inline in `getDashboardView`.
It moves to `lib/views/spend.ts` as `getCategorySpend(db, householdId,
period)`, called by both the dashboard and the alert evaluator.

If alerts grow their own copy of that query, the mail and the screen
eventually disagree about the same number — and an alert contradicting the
dashboard is worse than no alert, because it is the alert that gets
disbelieved.

## Evaluation

`evaluateAndNotify(db, mailer, householdId, { now })` is called at the
**household** level from exactly two places:

- `syncByItemId`, after `syncConnection`, resolving the household from the
  connection. This is what makes alerts arrive within minutes.
- `reconcileAll`, inside the existing per-household loop, **after**
  `refreshTransferFlags` and `recategorize`.

That ordering is load-bearing, unlike the existing pair: `recategorize` moves
spend between categories, so evaluating before it would mail about a category
the very next pass corrects.

Household level rather than per connection matters as soon as the second card
is connected in Slice 6. A per-connection call would evaluate twice per
reconcile and split one sync's crossings across two mails, breaking the
one-message promise even though dedupe would keep each line unique.

### The rule

For each category with a budget above zero, and each threshold in `[80, 100]`:

```
crossed = spentCents * 100 >= budgetCents * threshold

crossed && !fired  → fire
!crossed && fired  → clear (re-arm)
```

Integer multiplication rather than a ratio, so no float enters the money path.

Spend is the same figure the dashboard shows: non-transfer transactions dated
in the month, from `getCategorySpend`. The evaluator composes its rows exactly
as `getDashboardView` does — `getCategorySpend` for the amounts,
`listCategories` for which categories exist, `listBudgets` and `resolveBudget`
for the budget — so the two cannot disagree about what a category is or what
it is budgeted at.

Note what that figure includes: an instalment dated the 25th counts from the
1st, because the dashboard counts it from the 1st. So a category can cross a
threshold on money not yet charged. That is deliberate — it is money already
committed, and the alternative is an alert that contradicts the screen it
tells you to go and look at.

Edge cases, each decided here rather than at a call site:

- **No budget, or a budget of zero** — never fires, and any existing fired
  rows are cleared. Zero is treated as absent because zero is what the budget
  editor's empty state produces; alerting instantly at 100% on it would be
  noise, not a signal.
- **Negative spend** — an estorno pulling a category back under a threshold
  re-arms it, by the same single rule.
- **Uncategorized transactions** — no category, therefore no budget,
  therefore no alert. They are covered by the dashboard's uncategorized
  figure.
- **Archived categories** — evaluated over the same category list the
  dashboard renders, so an archived category stops alerting.

## Delivery

One mail per evaluation, to every user in the household, listing every
threshold fired in that evaluation — 100% lines before 80%, then by category
name. Plain text; no HTML in this slice.

- One crossing: subject `Supermercado is at 100% of its budget`.
- Several: subject `3 categories crossed a budget threshold`.
- Each body line: `Supermercado — R$ 1.240,00 of R$ 1.200,00 (103%)`.

Per-category messages are deliberately avoided: one shopping trip can cross
several thresholds at once, and a household that receives four mails from one
supermarket run learns to mute the sender.

No link back to the dashboard. There is no configured base URL to build one
from, and introducing an env var for it belongs with the Slice 6 deployment
work.

If a household has no users, nothing is sent and nothing is recorded.

## Error handling

**Send first, record second.** `fired_at` rows are written only after the send
succeeds, so a failed send leaves the threshold armed and the next sync
retries it. The inverse ordering loses an over-budget alert permanently on a
single transient Resend error. The risk this ordering accepts — a duplicate
mail if the process dies between send and write — is the cheaper failure.

**Clears are written regardless of send outcome.** Re-arming is not
notification, and it must not be held hostage to an unrelated mail failure.

**Alerts never fail a sync.** The whole call is wrapped in try/catch and
logged, exactly as `recategorize` already is inside `reconcileAll`. A Resend
outage must not 500 the webhook, because Pluggy would then retry the entire
sync over a mail that was never the point.

## Configuration

Two new required variables in the `lib/env.ts` schema, and in `.env.example`:

- `RESEND_API_KEY` — a secret, subject to the existing placeholder check.
- `ALERT_EMAIL_FROM` — the verified sending address.

Required rather than optional-with-silent-skip. A deployment that quietly
sends nothing while the dashboard reads "on track" is exactly the failure the
parent spec names as unacceptable; a missing key should stop the app at boot,
where it is obvious.

## Testing

Integration only, under the existing `pnpm test` — real PostgreSQL via
Testcontainers, Resend faked at the HTTP boundary with MSW as Pluggy already
is. Asserting a pure function directly inside that suite is fine; a mocked
database is not.

- **`tests/helpers/resend-server.ts`** — `createResendServer()`, mirroring
  `createPluggyServer`, handling `POST https://api.resend.com/emails` and
  capturing each payload so tests assert on what was actually sent, including
  recipients. A handler override returns 500 for the failure case.
- **`tests/alerts-domain.test.ts`** — the pure evaluator: fires, does not
  re-fire, clears on re-arm, absent and zero budgets, negative spend, and the
  exact boundary (spend at exactly 80% crosses).
- **`tests/alerts.test.ts`** — behaviour through real syncs:
  1. **Fires once.** Crossing 80% mails once across three repeated syncs;
     raising the budget and crossing again mails a second time. This is the
     parent spec's required case 6.
  2. **Batched.** 80% and 100% crossed in one sync produce one mail with two
     lines.
  3. **Re-arms on recategorization.** Moving a transaction out of a category
     clears its fired state.
  4. **Budget deleted.** Clears fired state; nothing is sent.
  5. **Send failure.** A Resend 500 leaves the threshold armed, and the next
     evaluation sends it.
  6. **One mail per reconcile.** A household with two connections receives
     one message, not two.
- **`tests/env.test.ts`** — the two new required variables.
- **`tests/dashboard-view.test.ts`** — unchanged, and that is the point: it is
  the regression guard proving the `getCategorySpend` extraction moved the
  query without moving a number.

## Risks

- **Sender reputation.** Resend requires a verified domain. Until one is
  configured, mail sent from the onboarding sender may land in spam — which
  reads identically to "no alert" from the household's side. Verify the
  domain before trusting the channel.
- **Duplicate mail on crash.** Accepted deliberately, above.
- **Alert fatigue.** Two thresholds per category per month is the ceiling.
  If that still proves noisy, the lever is dropping 80% rather than adding
  preferences.
- **Concurrent evaluation can duplicate a mail.** The nightly path evaluates
  each household once, but the webhook path evaluates per Pluggy item. Once
  a second connection exists (Slice 6), two `item/updated` webhooks for one
  household can be in flight at once: both read an empty fired set, both
  send, and `recordFired`'s `onConflictDoNothing` only collapses the rows
  afterwards. Send-before-record widens this window deliberately. Accepted
  for now as the same class as the crash duplicate already documented — a
  duplicate is cheaper than a lost alert — but Slice 6 should serialise per
  household, e.g. with `pg_advisory_xact_lock(hashtext(household_id))` at the
  top of the evaluation, before the second card lands.
- **A crossing in the final minutes of a month is never mailed.** Evaluation
  only ever considers the current period, so a purchase at 23:50 on the 31st
  whose webhook arrives at 00:05 on the 1st is evaluated against the new
  month, where spend is near zero. The old month's crossing is never
  revisited. The inverse — a false alarm on the boundary — cannot happen,
  since a new month starts at zero. Accepted: an alert about a month that
  has just closed has little value, and fixing it means evaluating more than
  the current period.
- **`alert_state` rows are never pruned.** Nothing reads or deletes a row
  once its period has passed; `clearFired` only ever touches the current
  period. Growth is bounded at roughly two rows per category per month per
  household, so this is a note rather than a problem — but there is no
  cleanup path, and since in-app alert history is a non-goal, nothing will
  ever read them either.
