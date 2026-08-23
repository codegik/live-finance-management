# Categorization (Slice 2) — Design

**Date:** 2026-08-23
**Status:** Approved for planning
**Parent spec:** `docs/superpowers/specs/2026-08-22-live-finance-management-design.md`

## Problem

Slice 1 delivered a ledger: every transaction from both cards arrives and is
listed by day. It cannot yet answer the question the project exists for —
*how much on supermarket this month* — because nothing knows what a
transaction is for. Every row is an amount and a noisy bank descriptor.

Budgets (Slice 3) are meaningless without categories, so this slice is the
prerequisite for the screen the household actually wants.

## Goals

- Every transaction carries a category, assigned automatically where possible.
- Manual corrections are never undone by a later sync.
- Correcting a merchant once fixes every past and future transaction from that
  merchant, immediately.
- Whatever cannot be categorized is visible and clearable, grouped so that
  clearing it is a handful of decisions rather than hundreds.

## Non-goals (this slice)

- Budgets, spend totals, pace, the dashboard — Slice 3.
- Installment projection and the forward view — Slice 4.
- Alerts of any kind, including the uncategorized nudge — Slice 5.
- `is_transfer` detection and checking-account hardening — Slice 6.

No column those slices need is created here. They arrive with the migration of
the slice that uses them.

## Decisions

| Question | Decision |
|---|---|
| Taxonomy shape | Flat. Seeded with 14 categories, then renamed, added to, or archived by the household |
| Pluggy category mapping | Fixed, versioned code map from Pluggy's strings to stable `seed_key` values |
| Rule match types | `EXACT` and `CONTAINS` only |
| Category removal | Archive, never delete |
| Where categorization runs | Stored on the transaction, computed by one shared function |
| Inbox unit of work | The normalized merchant, not the transaction |

## Architecture

The load-bearing choice is that **the resolved category is stored on the
transaction, and exactly one function decides it.**

Storing it is what lets Slice 3 aggregate with `SUM(amount_cents) GROUP BY
category_id` in SQL. Resolving at read time instead would apply rules
retroactively for free, but would push every budget total into application
code over the full transaction set, and would force Slice 3 into a worse
shape for no gain here.

The failure mode of stored categories is drift: the sync path and the backfill
path each assign categories, and over time they disagree. This design removes
the possibility by exposing a single entry point, `recategorize(db, scope)`,
which all three callers use. There is no second code path that assigns a
category.

### Module boundaries

Dependency arrows continue to point inward only.

- **`lib/domain/categorize.ts`** — pure, no I/O. Merchant normalization and
  the precedence resolution. Every decision in this slice is made here.
- **`lib/domain/pluggy-categories.ts`** — pure. The versioned Pluggy-string to
  `seed_key` map.
- **`lib/sync/categorize.ts`** — the thin I/O shell: `recategorize(db, scope)`.
- **`lib/db/categories.ts`, `lib/db/rules.ts`** — household-scoped queries,
  matching the existing `lib/db/` convention. No route handler composes an
  unscoped query.
- **`app/(app)/inbox/`, `app/(app)/settings/`** — orchestrate; do not decide.

## Data model

One migration. Two new tables, three new columns on `transaction`.

- **`category`** — `id`, `household_id`, `name`, `seed_key`, `sort_order`,
  `archived_at`, `created_at`. `seed_key` is a stable identifier
  (`'supermarket'`) for seeded rows and null for household-created ones;
  unique per household where not null.
- **`merchant_rule`** — `id`, `household_id`, `match_type`
  (`EXACT` | `CONTAINS`), `pattern`, `category_id`, `priority`, `created_at`.
  `pattern` is stored already normalized, so matching is symmetrical with the
  transaction side. Lower `priority` wins; see UI for the defaults.
- **`transaction`** gains `merchant_normalized`, `category_id` (nullable,
  references `category`), and `category_source`
  (`PLUGGY` | `RULE` | `MANUAL`, nullable).

Indexes: `category_id` on `transaction` — Slice 3's aggregation depends on it —
and `(household_id, merchant_normalized)` reachable for the inbox grouping and
the per-merchant backfill.

### Three departures from the parent spec

**No `parent_id`.** The taxonomy is flat. An unused hierarchy column would
force every Slice 3 budget query to answer "does this roll up?" for no
benefit. Reintroducing it later is a migration, not a redesign.

**No `REGEX` match type.** Regex over an already-normalized merchant string
buys very little and is a footgun with no UI to test a pattern against.
`EXACT` and `CONTAINS` cover the real cases. Addable later if one doesn't.

**Categories archive rather than delete.** Slice 3 stores budgets per category
per month and Slice 4 projects installments into future months; a hard delete
would strand historical spend and past budgets with no bucket. Archived
categories disappear from pickers but still render on transactions that
already carry them.

## Merchant normalization

Brazilian card descriptors are noisy in predictable ways.
`ZAFFARI PORTO ALEG *0421` and `ZAFFARI CENTRO PARC 03/12` are the same store.
Two mechanisms close that gap, and it matters which does which.

**The merchant name, when Pluggy supplies one.** v2 payloads often carry a
`merchant` object whose `name` is already the clean brand (`Zaffari`).
Normalization prefers it and falls back to the description only when it is
absent — the single largest source of collapsed variants, and it costs
nothing.

**Deterministic cleanup, for the rest.** `normalizeMerchant(raw)` uppercases,
strips accents, removes `PARC nn/nn` and bare `nn/nn` suffixes, drops
asterisk-delimited noise and trailing store numbers, and collapses whitespace.

What it deliberately does **not** do is strip city and branch fragments.
Reducing `ZAFFARI PORTO ALEG` to `ZAFFARI` requires knowing that
`PORTO ALEG` is a place, which needs a gazetteer of Brazilian place names and
their abbreviations. A heuristic that guessed — dropping trailing tokens, say
— would merge genuinely different merchants and silently misfile their spend.
An extra inbox group is a visible, one-tap cost; a wrongly merged merchant is
an invisible, wrong budget.

So where Pluggy gives no merchant name, `ZAFFARI PORTO ALEG` and
`ZAFFARI CENTRO` arrive as two inbox groups. **A `CONTAINS ZAFFARI` rule
unifies them permanently** — which is the concrete reason `CONTAINS` exists as
a match type, and why the inbox's rule prompt lets the pattern be edited down
before it is saved.

**Versioning without a version column.** The parent spec notes that changing
the normalizer requires a backfill. Rather than stamping a version on every
row, the nightly cron recomputes `merchant_normalized` household-wide. An
improved normalizer therefore self-heals within a day, with no migration and
no backfill job to write.

## Resolution

`resolveCategory(tx, rules, seedMap)` is pure and returns
`{ categoryId, source }`, applied in strict precedence order:

1. **`MANUAL` wins unconditionally.** A hand-set category is returned
   unchanged and is never reconsidered.
2. **Merchant rules**, ordered by ascending `priority` and then `id`, so the
   outcome is deterministic rather than dependent on row order.
3. **Pluggy's category**, mapped through `seed_key`, provided that category
   exists and is not archived.
4. Otherwise `null` — the transaction goes to the inbox.

## Recategorization

```
recategorize(db, scope) -> { changed: number }
  scope: { householdId, transactionIds }  // sync just touched these
       | { householdId, merchant }         // a rule was created or deleted
       | { householdId }                   // nightly self-heal
```

It loads the household's rules and categories once, recomputes
`merchant_normalized` and the resolved category for the rows in scope, and
writes only rows whose answer changed.

`MANUAL` rows are excluded **in the query predicate**, not filtered in
application code. The protection the parent spec calls load-bearing therefore
lives in a single `WHERE` clause rather than being remembered at three call
sites.

The returned count is surfaced to the user as *"23 transactions
recategorized"*, which is what makes the correction feel like it paid off.

### Callers

- **`syncConnection`** — with the ids it upserted, after the upsert loop.
- **Rule create and delete** — with the affected merchant, inside the same
  database transaction as the rule write, so a failed backfill cannot leave a
  rule that applied to only part of its history.
- **`/api/cron/reconcile`** — household-wide after the nightly sync. This is
  what lets normalizer and mapping improvements land without a migration.

Deleting a rule recategorizes its merchant too, so removing a bad rule undoes
its effect immediately instead of leaving stale assignments behind.

## UI

Mobile-first, consistent with the existing ledger.

**`/inbox`** — uncategorized transactions grouped by normalized merchant,
largest total first: *"ZAFFARI — 7 transactions, R$ 842,10"*. Tapping opens a
category sheet and offers **"Always categorize ZAFFARI as Supermercado?"**,
defaulted on, with the pattern and match type editable so a branch-specific
merchant can be shortened to the brand and saved as `CONTAINS`.

The toggle decides `category_source`, and the distinction matters:

- **Toggle on** (the common path) — the rule is written and `recategorize` by
  merchant assigns the group with source `RULE`, along with any older
  transactions from that merchant that a weaker rule or a Pluggy mapping had
  already categorized. The reported count is those rows, which is why it can
  exceed the size of the group on screen. Leaving them `RULE`-sourced means a
  later edit to the rule still reaches them.
- **Toggle off** — `MANUAL` is written to exactly the transactions in the
  group and nothing else moves. This is the one-off case: a charge that
  happens to be at that merchant but does not belong to its usual category.

Grouping is the point: twelve uncategorized ZAFFARI charges are one decision,
not twelve. An inbox that cannot reach empty stops being read.

**`/settings/categories`** — the seeded list, with add, rename, and archive.

**`/settings/rules`** — what the system has learned, with create and delete.
Inbox-created rules are always `EXACT` on the normalized merchant with priority
`100`; a hand-written `CONTAINS` rule defaults to priority `200`, so a specific
merchant match beats a broad substring match. Without this screen `CONTAINS`
would be a match type nothing could ever create.

There is no separate edit: deleting a rule and creating the replacement runs
the backfill in both directions — the old rule's transactions return to the
inbox, the new rule claims what it matches — which an in-place edit would have
to reimplement to be correct.

**`/ledger`** — each transaction gains a category chip, and the header gains
an uncategorized-count badge linking to the inbox. This is the only change to
an existing screen.

## Seeded taxonomy

A new household is created with a flat, editable set, each row carrying a
stable `seed_key`: Supermercado, Restaurantes, Delivery, Transporte,
Combustível, Saúde, Farmácia, Casa, Educação, Lazer, Vestuário, Assinaturas,
Pets, Outros.

The list is a starting point, not a contract. Renaming is free because the
Pluggy map targets `seed_key`, never the display name. Archiving a seeded
category makes its Pluggy hits fall through to the inbox rather than
resurrecting it.

## Error handling

A category that cannot be resolved is null, never a guess. An unmapped Pluggy
string, a mapping that points at an archived category, and a transaction no
rule matches all land in the same place — the inbox — because a wrong category
silently distorts a budget while an uncategorized one is visible.

Recategorization failures leave the previous assignment in place rather than
clearing categories, consistent with the parent spec's rule that stale data
beats blank data.

## Testing

Integration tests only, per the project-wide constraint: real PostgreSQL via
Testcontainers, real route handlers and queries, Pluggy served by MSW from
recorded fixtures.

Parent spec case **4 — a hand-set category is unchanged after a subsequent
sync reporting a different Pluggy category** — is covered here; it is the
guarantee this slice exists to make. Alongside it:

1. A descriptor's `PARC 03/12` and `*0421` suffixes are stripped, and a
   transaction whose Pluggy payload carries `merchant.name` normalizes from
   that name rather than from its noisier description.
2. Two branch variants of one merchant arrive as separate inbox groups, and a
   single `CONTAINS` rule categorizes both — including retroactively.
3. Full precedence: `MANUAL` beats rule beats Pluggy beats inbox.
4. Creating a rule backfills past non-`MANUAL` transactions and leaves
   `MANUAL` ones untouched.
5. Deleting a rule returns its transactions to the inbox.
6. An archived category still renders on transactions carrying it, and is
   absent from the picker.
7. A transaction with no Pluggy merchant normalizes from its description.
8. Recategorization is idempotent: running it twice changes nothing the second
   time.
9. Assigning a group with the rule toggle off writes `MANUAL` and creates no
   rule; assigning with it on writes `RULE` and a later edit to that rule
   still moves those transactions.
10. An `EXACT` rule beats a `CONTAINS` rule that also matches, at their default
   priorities.

## Definition of done

- Every transaction from a real sync carries a category or appears in the
  inbox.
- The inbox can be driven to empty, and stays empty for merchants already
  ruled.
- A correction made once is not asked for again.
- `pnpm test` passes; `pnpm build` succeeds.

## Risks

- **Normalization is deliberately conservative,** so one merchant will
  sometimes split across several inbox groups where Pluggy supplies no
  merchant name. `CONTAINS` rules are the intended remedy. The bias is chosen:
  a split merchant is visible in the inbox, a wrongly merged one is a silently
  wrong budget. The nightly household-wide recompute makes tuning cheap if the
  split proves annoying in practice.
- **Pluggy's taxonomy can change.** New or renamed category strings fall
  through to the inbox rather than mapping wrongly, which is the safe
  direction, but the map needs occasional attention.
