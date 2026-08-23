# Budgets, Forward View and Transfers (Slice 3) — Design

**Date:** 2026-08-23
**Status:** Approved for planning
**Parent spec:** `docs/superpowers/specs/2026-08-22-live-finance-management-design.md`
**Predecessor:** `docs/superpowers/specs/2026-08-23-categorization-design.md`

## Problem

Slices 1 and 2 deliver a categorized ledger: transactions arrive day by day
and 90% of them land in a category automatically. Nothing yet answers the
question the project exists for — *how much have we spent on supermarket this
month, and is that within budget?*

This slice answers it, and closes two gaps that real data exposed.

## What real data changed

Two findings from a live connection (1,537 transactions, one credit card,
2025-10 to 2027-07) reshaped the plan the parent spec laid out.

**Pluggy already delivers future instalments.** 99 future-dated rows worth
R$30,311.91 are on file, and every one of them is an instalment —
`AUTO MECANICA BOA 01/10` through `10/10` all exist today, one per month. The
parent spec's Slice 4 assumed these had to be synthesised: generate parcelas
*k+1..N* as `is_projected` rows, join them by a hash of
`(account, merchant, total, amount)`, then reconcile each projection against
the real charge when it arrived — and it flagged that hash as collision-prone.
None of that is needed. The forward view is a query over rows that already
exist, so this slice absorbs it and Slice 4 disappears.

This is one connector. If a second card's connector turns out not to emit
future parcelas, projection comes back as its own slice — but it is not
speculative work to do now.

**The card statement carries its own invoice payments.** `Credit card payment`
is 10 rows, all negative, totalling −R$177,174.79, alongside `Transfers`
(R$2,968.42), `Tax on financial operations` (R$1,113.89) and `Credit card
fees` (R$157.50). They are uncategorized, so they cannot corrupt a
per-category budget — but they sit in the ledger's daily totals, and any
household total would be wrong by the value of every invoice ever paid.
The parent spec deferred `is_transfer` to Slice 6; it has to come forward,
because this slice is the one that introduces totals.

## Goals

- Per-category monthly budgets, set once and carried forward.
- Spent, budget and a pace signal that surfaces trouble mid-month.
- Forward visibility: months already committed by instalments.
- Money that is not spending — invoice payments, transfers, fees — excluded
  from every figure.

## Non-goals (this slice)

- Alerts of any kind, including the 80%/100% thresholds — Slice 5.
- The second connection, checking accounts, consent renewal — Slice 6.
- Per-transaction category correction — deferred from Slice 2, still deferred.
- Instalment *projection*. See above: the data makes it unnecessary.

## Decisions

| Question | Decision |
|---|---|
| Budget period | Calendar month, by purchase date |
| Carry-forward | Resolved at read time, never by writing future rows |
| First-run amounts | Proposed from the household's own median monthly spend, then edited |
| Pace | Variable spend extrapolated; committed instalments added at face value |
| Transfers | Hidden from ledger, inbox and totals by default; visible behind a toggle |
| Spend aggregation | Read-time SQL, no materialised totals |
| Instalment identity | Parsed from the descriptor at ingest, not synthesised |

## Architecture

**Spend is aggregated at read time.** One `SUM(amount_cents) GROUP BY
category_id` per month, filtered by `NOT is_transfer`, using the
`transaction_category_idx` Slice 2 already created. At 1,537 rows growing by a
few hundred a month this is a single indexed scan.

Materialising monthly totals was considered and rejected. `recategorize` moves
thousands of rows at once, so every rule created or deleted would have to
invalidate the right buckets — reintroducing one layer up exactly the drift
problem Slice 2 spent a task eliminating. A cache was rejected for the simpler
reason that the query is not slow.

### Module boundaries

Dependency arrows continue to point inward only.

- **`lib/domain/budget.ts`** — pure. Month bounds, carry-forward resolution,
  pace, median suggestion. Every number that could be wrong is decided here.
- **`lib/domain/transfers.ts`** — pure. Which Pluggy categories are not
  spending.
- **`lib/domain/installments.ts`** — pure. Parsing `nn/nn` out of a descriptor.
- **`lib/db/budgets.ts`** — household-scoped budget queries.
- **`lib/views/dashboard.ts`, `lib/views/forward.ts`** — compose queries and
  pure functions into what a screen renders.
- **`app/(app)/dashboard/`, `app/(app)/budgets/`, `app/(app)/forward/`** —
  orchestrate; do not decide.

### Why `is_transfer` is not part of `recategorize`

`recategorize` excludes `MANUAL` rows in its query predicate — that is the
guarantee Slice 2 exists to make. But whether a row is an invoice payment has
nothing to do with who set its category: a `MANUAL` row must still be flagged.

So transfer detection gets its own pass, `refreshTransferFlags(exec,
householdId)`, called from the nightly reconcile beside `seedCategories`. One
`UPDATE` keyed on `pluggy_category`, no `MANUAL` exclusion, deterministic and
idempotent. Same shape as its neighbour, different predicate, and the reason
is written down where the next reader will look for it.

## Data model

One migration. One new table, three new columns on `transaction`.

- **`budget`** — `id`, `household_id`, `category_id`, `period_month`,
  `amount_cents`, `created_at`, `updated_at`. Unique on
  `(household_id, category_id, period_month)`. `period_month` is a `date`
  always set to the first of the month, so it sorts and ranges without string
  parsing.
- **`transaction`** gains:
  - `is_transfer` — boolean, not null, default false.
  - `installment_number`, `installment_total` — integers, nullable. Both set
    or both null.

Index `transaction_transfer_idx` on `(is_transfer)` is **not** created: the
column is low-cardinality and every money query already filters by household
through `account → connection`. `transaction_date_idx` on `date` is created,
because month-range scans are the one access pattern Slice 1's indexes do not
serve.

### Carry-forward, stated precisely

The budget for category *C* in month *M* is the `budget` row for
`(C, M)` if one exists; otherwise the row for *C* with the greatest
`period_month` earlier than *M*; otherwise none.

Editing a month therefore affects that month and every later month with no
explicit row of its own. No job writes future rows, so changing a budget can
never leave stale ones behind.

## Instalments

`parseInstallment(description)` extracts `{ number, total }` from the parcel
suffixes the normalizer already recognises — `PARC 03/12`, `PARCELA 3/12` and
a bare `03/12`. It returns null when there is no such suffix, and rejects
nonsense (`00/12`, `13/12`) rather than storing it.

Set at ingest in `lib/pluggy/mapper.ts`, beside `merchant_normalized`, and
refreshed on every upsert so a corrected descriptor corrects the parse.

A transaction with `installment_total` set is **committed**: the household has
already decided to spend it, whether or not the date has arrived. That is the
definition pace and the forward view both use, and it is the whole reason
these columns exist rather than being deferred.

## Pace

```
projected = (variableCents / dayOfMonth) × daysInMonth  +  committedCents
```

where, for every non-transfer row in the month:

- `variableCents` — no `installment_total`, dated on or before today.
- `committedCents` — everything else in the month: every instalment whatever
  its date, plus any non-instalment row dated later this month. No such
  non-instalment future row was observed in real data, but treating one as
  committed rather than as evidence of a spending rate is the safe reading:
  it is a known amount, not a sample.
- `spentCents`, reported separately, is simply both together — what the month
  will cost as currently known.

Variable spending extrapolates because it is a rate. Instalments do not,
because they are a known list. Without the split, a single R$1,147 car
instalment on the 15th implies R$7,000 of car spend by month end — the false
alarm that trains a household to ignore the number. A row can therefore say
*"R$2,300 projected, R$1,147 of it already committed."*

**Pace exists only for the current month.** A finished month has nothing to
project, and a future month has no elapsed days to extrapolate from — the
forward view shows its committed total against its budget instead. Computing
a "pace" for either would be arithmetic dressed as insight.

Edge cases: `dayOfMonth` is at least 1, so the first of the month does not
divide by zero. A category with no budget shows spend and no bar rather than a
0% bar, because "no budget" and "budget of zero" are different statements. A
category with a budget and no spend shows an empty bar, which is information.

## Budget suggestions

`medianMonthlySpend(category)` over **complete** months only — excluding the
current partial month and every future month, which hold nothing but
instalments and would drag the median down. Median rather than mean, so one
R$1,147 car month does not set the car budget for the year.

The budget screen shows the suggestion beside the figure it came from, so
accepting it is an informed act rather than a shrug. Nothing is written until
the household saves.

## Transfers

`isTransfer(pluggyCategory)` is true for `Credit card payment`, `Transfers`,
`Tax on financial operations` and `Credit card fees`.

VERIFIED AGAINST REAL DATA: these four strings were read off a live statement,
not taken from documentation. When checking accounts arrive in Slice 6 the
same flag will need a second detector — matching an invoice payment leaving
checking against the card it settles — and this function is where it goes.

Flagged rows are excluded from the ledger, the inbox, every category total and
the household total. A "show transfers" toggle on the ledger reveals them.
Nothing is deleted: the rows remain, so the ledger can still be reconciled
line-for-line against a bank statement when someone needs to.

## UI

**`/dashboard`** — the current month, and only the current month; there is no
month picker here. Past months are history and future months are the forward
view's job, so the screen that has to be readable at a glance stays about the
month you can still change. One row per category: spent, budget, a
bar, and pace. A row over budget and a row whose *pace* is over budget are
rendered differently, because they are different problems: one has happened,
the other is a forecast. Household total, uncategorized badge, and the
stale-connection banner, so the dashboard can never read as "on track" while a
connection is degraded. `/` redirects here rather than to `/ledger`.

**`/budgets`** — one month at a time with a month picker, one field per
category, pre-filled with the suggestion where no budget exists. Saving writes
only the categories actually set.

**`/forward`** — the next 6 months, each showing committed instalments per
category against that month's carried-forward budget.

**`/ledger`** — gains a "show transfers" toggle, off by default. The only
change to an existing screen.

## Error handling

A stale connection must never render as "on track": the dashboard carries
`HouseholdHealth` and shows the same banner the ledger does, because an
under-reported total that looks healthy is worse than a visible error.

A category with no budget is a first-class state, not a zero. A month with no
transactions renders as empty rather than as a set of zero bars.

## Testing

Integration tests only, per the project-wide constraint: real PostgreSQL via
Testcontainers, real route handlers and queries, Pluggy served by MSW from
recorded fixtures. Pure functions are asserted directly inside the same suite.

Parent spec case **2 — an invoice payment does not double-count against any
budget** — lands here, and real data makes it concrete: R$177,174.79 of
`Credit card payment` must be absent from every total. Alongside it:

1. A budget set in August applies in October by carry-forward; an explicit
   October row overrides it; editing August leaves October's own row alone.
2. Pace separates variable from committed: an instalment adds its face value,
   not an extrapolation.
3. A purchase on the last day of a month counts in that month's budget, not
   the next — re-asserted at the budget layer, not only at ingest.
4. A category with no budget shows spend and no bar.
5. The median suggestion ignores the current partial month and future months.
6. The forward view shows only committed instalments, and only future months.
7. Transfers are absent from the dashboard, the household total and the inbox,
   and present when the ledger toggle is on.
8. `parseInstallment` reads `01/10`, `PARC 03/12` and `PARCELA 3/12`, and
   rejects `00/12` and `13/12`.

## Definition of done

- The dashboard answers *how much on supermarket this month, and is that
  within budget* for the current month.
- Budgets set once carry forward without any job writing future rows.
- The household total excludes every invoice payment and fee.
- The forward view shows the months already committed by instalments.
- `pnpm test` passes; `pnpm build` succeeds.

## Risks

- **One connector.** Both findings above come from a single card. A second
  issuer may not emit future parcelas, and may spell its transfer categories
  differently. Both detectors are pure functions with their observed inputs
  recorded in tests, so a second connector's data extends them rather than
  forcing a redesign.
- **Median suggestions on thin history.** A category with two complete months
  of data gets a weak suggestion. It is shown beside its source figures, and
  it is only ever a default.
