# Live Finance Management — Design

**Date:** 2026-08-22
**Status:** Approved for planning

## Problem

Two people, two credit cards, two separate bank apps. Each app shows its own
invoice, and neither shows a category budget. There is no way to answer the
question that actually matters day to day: *how much have we spent on
supermarket this month, and is that within budget?* Answering it today means
manually reconciling two invoices against a budget that lives nowhere.

## Goals

- Both cards and both checking accounts flow into one categorized ledger,
  updated day by day rather than at invoice close.
- Every transaction lands in a category automatically, and the system learns
  from corrections instead of repeating them.
- Per-category monthly budgets with a mid-month pace signal, not just a
  post-hoc total.
- Forward visibility: future months already committed by installments, so
  spending can be planned in advance.
- Proactive alerts at 80% and 100% of a category budget.

## Non-goals (v1)

- Native mobile apps. Mobile-first web only.
- Multi-tenant product for other households.
- Investments, net worth, or tax reporting.
- Bill payment or any money movement. Read-only throughout.

## Decisions

| Question | Decision |
|---|---|
| Data intake | Pluggy (Open Finance Brasil aggregator) |
| Accounts covered | Credit cards **and** checking accounts |
| Users | Two logins, one shared household |
| Categorization | Pluggy category + own merchant rules, learning from manual corrections |
| Budget period | Calendar month, by purchase date |
| Card due date | Configured per card (e.g. the 10th), for invoice context |
| Installments | Each parcela counts in its own month, plus a forward commitments view |
| Platform | Hosted web app, mobile-first |
| Alerts | Threshold alerts at 80% / 100%, plus uncategorized nudge |
| Testing | Integration tests only (see Testing) |

## Architecture

Single Next.js application (App Router) deployed to Vercel, with managed
Postgres (Neon) accessed through Drizzle. Auth.js for authentication. Vercel
Cron for scheduled work. One repo, one deploy, one language.

This shape was chosen because every requirement reduces to *read-heavy
dashboard + webhook + cron*, which is exactly what this stack does with the
least machinery. A public HTTPS endpoint for Pluggy webhooks comes free.

### Module boundaries

Dependency arrows point inward only.

- **`lib/domain/`** — pure TypeScript, no I/O. Categorization resolution,
  budget period math, installment projection, pace calculation, threshold
  evaluation. Every non-trivial decision in the system is made here.
- **`lib/pluggy/`** — the only module aware that Pluggy exists. Exposes
  `syncItem(itemId)` and translates Pluggy payloads into the internal
  `Transaction` shape. Replacing the aggregator means rewriting this module
  and nothing else.
- **`lib/db/`** — Drizzle schema and queries. Household scoping is applied in
  one place rather than remembered per call site.
- **`app/`** — routes, server components, webhook handler, cron handlers.
  Orchestrates; does not decide.

### Cross-cutting rules

1. **Money is stored as integer centavos.** No floating point anywhere in the
   money path. A budget off by R$0,01 undermines trust in every other number.
2. **All date bucketing uses `America/Sao_Paulo`.** "Which calendar month" is
   the central question the budget asks; a UTC server silently pushes a
   late-night purchase on the 31st into the following month.
3. **Read-only.** The system never initiates a payment or transfer.

## Data model

- **`household`** — `id`, `name`.
- **`user`** — `id`, `email`, `name`, `household_id`. Both spouses log in
  separately and see the same household data.
- **`connection`** — one row per Pluggy Item (one bank login). `household_id`,
  `pluggy_item_id`, `institution`, `owner_user_id`, `status`,
  `last_synced_at`. `owner_user_id` is what makes "whose card" answerable.
- **`account`** — `connection_id`, `pluggy_account_id`, `type`
  (`CREDIT` | `BANK`), `name`, `last4`. Credit accounts additionally carry
  `due_day` and `closing_day`.
- **`transaction`** — `account_id`, `pluggy_transaction_id` (unique; the
  idempotency key), `date` (purchase date), `amount_cents`, `description`,
  `merchant_raw`, `merchant_normalized`, `pluggy_category`, `category_id`,
  `category_source` (`PLUGGY` | `RULE` | `MANUAL`), `is_transfer`,
  `is_projected`, `installment_group_id`, `installment_number`,
  `installment_total`.
- **`category`** — `household_id`, `name`, `parent_id`.
- **`merchant_rule`** — `household_id`, `match_type` (`EXACT` | `CONTAINS` |
  `REGEX`), `pattern`, `category_id`, `priority`.
- **`budget`** — `household_id`, `category_id`, `period_month`,
  `amount_cents`. One row per category per month.
- **`alert_state`** — `household_id`, `category_id`, `period_month`,
  `threshold`, `fired_at`. Deduplicates alert delivery.

`category_source` is load-bearing: it records *why* a transaction carries its
category, which is what allows manual choices to be protected from later syncs
and allows the UI to explain itself.

### Avoiding double-counting

Once checking accounts are connected, the credit card invoice payment leaving
the checking account is the same money as the card transactions it settles.
Invoice payments are flagged `is_transfer = true` and excluded from all budget
calculations. Without this every real is counted twice.

## Sync

**Connecting.** The server mints a Pluggy Connect Token; the browser opens the
Pluggy Connect widget; the user authenticates directly with their bank.
Credentials never reach this application. The widget returns an `itemId`,
stored as a `connection` owned by the logged-in user.

**Staying current.** Two deliberately overlapping mechanisms:

- **Webhook** at `/api/webhooks/pluggy`, signature-verified, triggered on item
  updates. This is what makes the data day-by-day.
- **Nightly cron** re-fetches a rolling 90-day window. This is not mere
  redundancy: card transactions mutate (pending charges post at different
  amounts, estornos arrive), and webhooks can be missed during a deploy.

Every write is an upsert keyed on `pluggy_transaction_id`, so any sync is
idempotent by construction.

## Categorization

A single pure resolution function, applied in strict precedence order:

1. **`MANUAL` wins unconditionally.** A hand-set category is never overwritten
   by any subsequent sync.
2. **Merchant rules**, evaluated by priority.
3. **Pluggy's category**, mapped through the household taxonomy.
4. Otherwise the transaction goes to the uncategorized inbox.

### Merchant normalization

Brazilian card descriptors are noisy: `ZAFFARI PORTO ALEG *0421` and
`ZAFFARI CENTRO PARC 03/12` are the same store. A deterministic normalizer
uppercases, strips accents, and removes store numbers, city fragments,
`PARC nn/nn` suffixes and asterisk-delimited noise, collapsing both to
`ZAFFARI`. Rules match on the normalized form, so one rule covers every future
visit. Normalization is deterministic and versioned; changing it requires a
backfill.

### Learning from corrections

When a transaction is recategorized by hand, the UI offers: *"Always
categorize ZAFFARI as Supermercado?"* Accepting writes a `merchant_rule` and
**backfills immediately** — every past transaction from that merchant whose
`category_source` is not `MANUAL` is recategorized, and affected budget
totals and alert states are recomputed. The correction pays off on the spot
rather than only going forward.

## Installments

Pluggy reports that a transaction is parcela *k* of *N*. On seeing it, the
system generates the remaining parcelas *k+1..N* as rows with
`is_projected = true`, dated in their respective future months and joined by
`installment_group_id`. Projected rows count against **future** months only,
never the current one. These rows are the substance of the forward view.

`installment_group_id` is a deterministic hash of
`(account_id, merchant_normalized, installment_total, amount_cents)`. This is
a heuristic rather than an identifier Pluggy provides: two genuinely distinct
purchases from the same merchant, for the same amount, in the same number of
parcelas would collide. The consequence of a collision is a mis-linked
projection, not lost data, and the nightly reconcile corrects it once the real
charges arrive. If a Pluggy connector exposes a stable purchase identifier,
prefer it over the hash.

**Reconciliation.** When the real parcela *k+1* arrives, it is matched on
`(installment_group_id, installment_number)` and replaces the projection.

Two edge cases handled explicitly:

- **Early payoff.** Projections whose expected month has passed with no
  matching real transaction are expired by the nightly job, so a settled
  purchase stops distorting the forecast.
- **Estornos.** Refunds arrive as negative amounts and reduce category spend
  rather than being suppressed.

## Budgets

Budgets are stored per category **per month**. Setting an amount carries it
forward to subsequent months by default, while allowing any individual month
to be overridden — December for Christmas, July for vacation. This is what
makes planning ahead possible rather than merely reacting.

Carry-forward is resolved at read time, not by eagerly writing future rows:
the budget for a category in month *M* is the row for *M* if one exists,
otherwise the most recent row before *M*. Editing a month therefore affects
that month and every later month with no explicit row of its own, and no
backfill job is needed when a budget changes.

Each category row presents three values:

- **Spent** — posted, non-transfer transactions in the month.
- **Budget** — the amount for that category and month.
- **Pace** — an end-of-month projection combining spend to date, the implied
  daily rate over remaining days, and known committed installments falling in
  that month. This is what surfaces trouble on the 12th rather than the 30th.

Every row can be broken down by which card, and therefore by which spouse.

## Alerts

Evaluated after each sync and again on the nightly cron. Thresholds at 80%
and 100% of a category budget, per category per month, deduplicated through
`alert_state` so a crossing notifies once rather than on every subsequent
sync.

- **One message per sync, not per category.** A single shopping trip can cross
  several thresholds; these are batched into one email listing all of them.
  Per-category messages would train the recipient to mute the channel.
- **State resets when the underlying numbers change.** Raising a budget, or
  recategorizing a transaction out of a category, clears the fired state so a
  later genuine crossing can fire again.

Delivery is email via Resend to both household users in v1. Web push is a
later addition, once the alerts have proven accurate. A separate daily nudge
fires when transactions are sitting uncategorized.

## UI

Five mobile-first screens:

1. **Dashboard** — current month, all categories, spent/budget/pace bars,
   household total, uncategorized count badge.
2. **Category detail** — the transactions behind a number, each tagged with
   its card and owner.
3. **Inbox** — uncategorized transactions, one-tap assignment, with the
   "always do this" prompt.
4. **Forward view** — the next 3–6 months, committed installments against
   budget.
5. **Settings** — connections, card due days, categories, budgets, alert
   preferences.

## Error handling

**A stale connection must never render as "on track."** When a bank
connection degrades — MFA challenge, changed password, revoked consent —
Pluggy reports the item status and the application surfaces a persistent
banner naming the institution, while every affected figure carries a
staleness marker until the connection is restored. Silently under-reported
spend that looks healthy is a worse failure than a visible error, because it
is acted upon.

Missed webhooks require no special handling; the nightly reconcile is the
recovery path. Pluggy API failures are logged and retried with backoff, and
leave the last known good data in place rather than blanking the dashboard.

## Testing

**Integration tests only** — no unit test layer. Tests run against a real
Postgres instance with recorded Pluggy payloads as fixtures, exercising real
route handlers and real queries.

This is a deliberate tradeoff: fewer, more realistic tests, at the cost of
slower localization when a defect is in pure logic such as timezone bucketing
or installment projection, since failures are read through the database rather
than at the function boundary. The six cases below are therefore written as
integration tests rather than dropped.

Required cases, each one a way the application could quietly report something
false:

1. **Month boundary.** A purchase late on the 31st in `America/Sao_Paulo`
   lands in that month, not the next.
2. **Invoice payment.** A card invoice payment observed on the checking
   account does not double-count against any budget.
3. **Idempotent re-sync.** Replaying the same Pluggy payload produces no
   duplicate transactions and no changed totals.
4. **Manual category survives.** A hand-set category is unchanged after a
   subsequent sync that reports a different Pluggy category.
5. **Installment lifecycle.** Parcela 1 of 12 projects 11 future rows; the
   arrival of the real parcela 2 replaces its projection without changing the
   month's total.
6. **Alert fires once.** Crossing 80% notifies a single time across repeated
   syncs, and re-arms after the budget is raised.

## Build order

The v1 surface is broad, so it is built in slices that each end somewhere
useful rather than in horizontal layers:

1. **Ledger.** Auth, household, one Pluggy connection, sync, transactions
   listed. Proves the data actually arrives.
2. **Categorization.** Taxonomy, resolution order, normalization, inbox,
   merchant rules with backfill.
3. **Budgets.** Monthly amounts, spent/budget/pace, category detail.
4. **Installments.** Projection, reconciliation, forward view.
5. **Alerts.** Threshold evaluation, dedupe, batched email.
6. **Hardening.** Second connection and checking accounts, transfer
   exclusion, stale-connection surfacing.

Steps 1–3 are the smallest slice that answers the original question — *how
much on supermarket this month, and is that within budget* — and should be
usable before the rest is built.

## Risks and open questions

- **Pluggy pricing.** The sandbox is free; connecting real accounts is a paid
  tier. Pricing needs to be confirmed against expected usage before build
  begins. This does not block design but does gate the project.
- **Connector coverage.** Confirm both specific card issuers are supported by
  Pluggy connectors at the required data depth, specifically that credit card
  installment metadata is present for both.
- **Consent renewal.** Open Finance Brasil consents expire and require
  periodic re-authorization. The stale-connection handling above covers the
  symptom; the renewal reminder flow is v1 scope but its cadence depends on
  the issuers.
