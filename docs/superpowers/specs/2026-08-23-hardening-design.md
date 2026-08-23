# Hardening (Slice 6) — Design

**Date:** 2026-08-23
**Status:** Approved for planning

**Parent spec:** `docs/superpowers/specs/2026-08-22-live-finance-management-design.md`
**Predecessor specs:** `docs/superpowers/specs/2026-08-23-categorization-design.md`,
`docs/superpowers/specs/2026-08-23-budgets-design.md`,
`docs/superpowers/specs/2026-08-23-alerts-design.md`

## Problem

Everything built so far was proved against one credit card. The household has
two cards and two checking accounts, and they are about to be connected.

Two things break at that moment. The first is arithmetic: the invoice payment
leaving checking is the same money as the card transactions it settles, and
counted as spend it doubles the month. `lib/domain/transfers.ts` names this
and defers it to this slice. The second is sign convention: on a card a
`CREDIT` is an estorno and correctly reduces category spend, but on checking a
`CREDIT` is salary, and the same rule would credit thousands of reais against
a budget.

There is also nowhere to manage what is connected. The only entry point is a
button on `/ledger`; a connection that breaks at 7am shows a banner naming the
institution and offers no way to fix it.

## Goals

- Both cards and both checking accounts flow into one household ledger, with
  every figure counting each real once.
- Money arriving in a checking account never offsets a budget.
- A broken connection can be repaired from the phone, in the place the banner
  points to.
- A new account opened on an already-connected bank login appears without a
  reconnect.

## Non-goals

- **The pairing detector.** Matching a checking-side debit against the card
  invoice it settles, by amount and date, when Pluggy's category does not say
  so. Contingent, not dismissed: see *Verification before code* below. It is
  held back because its failure mode — an ordinary purchase for the same
  amount as an invoice paid the same week, silently removed from the budget —
  is exactly the kind of quiet wrongness the parent spec ranks below a visible
  error.
- **Connection archiving.** A closed card stays connected and eventually goes
  stale, so the banner nags about it. Accepted: closing a card is rare, and
  the alternative is a column plus a filter on the sync and health paths for a
  case that has not happened.
- Category detail screen, uncategorized nudge, alert preferences.

## Decisions

| Question | Decision |
|---|---|
| Checking spend | Everything except transfers counts against budgets |
| Income | Excluded from budgets by category, like transfers |
| Exclusion mechanism | One three-way `budget_role` enum, category-driven |
| Unknown category | `SPEND` — visible in the inbox, never silently dropped |
| Invoice payment on checking | Pluggy category, verified against live data first |
| Due / closing day | Editable as an override column, Pluggy's value as default |
| Connection removal | Hard delete behind a confirmation naming what is lost |
| Closed cards | Not handled this slice |

## Approach: one classifier, not two booleans

Both new exclusions — the checking-side invoice payment and income — are the
same shape: a transaction that is real money movement but not spending. They
could be two booleans, `is_transfer` and `is_income`, or one enum.

One enum, because every consumer asks the same question. `getCategorySpend`,
the inbox, the forward view and the budget editor all want *is this row
spending*, and with two booleans each of them repeats a two-clause predicate
that a third exclusion would have to find and extend. The enum makes the
question `budget_role = 'SPEND'` in one place per query, and makes the
classifier total: every category resolves to exactly one role.

`lib/domain/transfers.ts` becomes `lib/domain/budget-role.ts`:

```ts
export type BudgetRole = 'SPEND' | 'TRANSFER' | 'INCOME'
export const TRANSFER_PLUGGY_CATEGORIES: ReadonlySet<string>
export const INCOME_PLUGGY_CATEGORIES: ReadonlySet<string>
export function classifyRole(pluggyCategory: string | null | undefined): BudgetRole
```

`SPEND` is the default and the fallback. An unrecognised category is not an
exclusion — it goes to the inbox, where it is visible, rather than being
dropped from every figure. This preserves the rule the predecessor module
states and the categorization slice depends on.

### Two behaviour changes worth stating

- **Income stops reaching the inbox.** The inbox filters on the same
  predicate as the budget, so a salary row is excluded from both. Asking the
  household to categorize its own salary is noise.
- **A card estorno is still `SPEND`.** It reduces its category exactly as
  today. Only categories on the income list flip to `INCOME`, and refunds do
  not carry them. A test asserts this, because it is what fails if the income
  list is drawn too wide.

## Data model

`transaction.is_transfer` (boolean) becomes `transaction.budget_role`
(`budget_role` pg enum, `NOT NULL DEFAULT 'SPEND'`). Migration `0009`:

1. Creates the enum and adds the column.
2. Backfills `'TRANSFER'` where `is_transfer = true`.
3. Backfills `'INCOME'` where `pluggy_category` is in the income list,
   written out in SQL.
4. Drops `is_transfer`.

The income list is duplicated into SQL for the same reason `0006` duplicated
the transfer list: the nightly pass that would otherwise correct these rows is
up to 24 hours away at deploy time, and until it runs every income row is
counted as spend. `tests/transfers.test.ts` already asserts the SQL and
TypeScript transfer lists agree; the income list joins that assertion, so a
silent divergence fails the suite rather than the household's totals.

`account` gains `due_day_override` and `closing_day_override` (nullable
integers). Reads resolve `coalesce(override, due_day)`. Sync keeps writing the
Pluggy-sourced columns freely, so an edit can never be clobbered by the next
sync and the sync path needs no knowledge that overrides exist.

## Sync

**`refreshAccounts(db, pluggy, connectionId)`** is extracted from
`attachConnection` and called by `syncConnection` as well. Today accounts are
read from Pluggy exactly once, at connect time; a checking account opened on
an already-connected login would never appear. Being an upsert on
`pluggy_account_id`, calling it every sync is idempotent.

**`refreshTransferFlags` becomes `refreshBudgetRoles`**, reconciling all three
roles instead of one boolean. Both properties its predecessor's comment
defends are kept: no `MANUAL` exclusion, because whether a row is an invoice
payment has nothing to do with who set its category; and it moves rows in
every direction, so a row whose category stopped being income becomes spending
again. This is what makes an extended category list land without a migration.

Nothing else in the sync path changes. `reconcileAll` already iterates every
connection, isolates each failure, and evaluates alerts per household;
`attachConnection` already refuses an item that belongs to another household,
in SQL as well as in a pre-check.

## Connections screen

New route `app/(app)/settings/connections/`, following the shape of
`settings/categories` and `settings/rules` — server-component `page.tsx`,
`actions.ts`, `state.ts`, one client component for the forms.

**List.** One block per connection: institution, owner's name, status, last
synced, and beneath it each account — type, name, `••1234`, and the resolved
due day for credit accounts. With four accounts across two logins, this is the
screen that answers *whose card is that*.

**Connect.** `ConnectCardButton` moves here from `/ledger`, relabeled
"Connect a bank" now that it takes checking too. The app nav gains a
Connections link, `/ledger`'s empty state links here, and `StaleBanner` names
each stale institution as a link here — today the banner reports a problem and
offers nowhere to go.

**Reconnect.** `createConnectToken(itemId?)` already supports Pluggy's update
mode, so this is wiring: `POST /api/pluggy/connect-token` accepts an optional
`itemId` and **verifies the item belongs to the caller's household before
minting a token for it**. That check is the security-relevant part of this
slice: without it, any signed-in user could obtain an update-mode token for
any item id they can name. On success the existing `POST /api/connections`
call re-runs `attachConnection`, refreshing status and accounts, and syncs.

**Due and closing day.** A small per-account form writing the override
columns. The UI shows the Pluggy value and marks an override as an override.

**Remove.** A server action behind a confirmation naming the institution and
the exact count of transactions it destroys. The FK cascade runs
`connection → account → transaction`, so removal takes the whole history with
it. This is correct for the case it exists for — a wrong or test connection
during setup — and the confirmation exists because it is the one irreversible
action in the slice.

## Verification before code

Task 1 of the implementation plan is a read-only script,
`scripts/dump-categories.ts`, listing distinct Pluggy `category` values by
account type across the live connections, with counts and total value. It is
throwaway and not shipped.

`INCOME_PLUGGY_CATEGORIES` is written from its output rather than from
documentation, exactly as the four transfer strings were read off a live
statement.

The script is also the gate on the pairing detector. If it shows checking-side
invoice payments arriving uncategorized, or under a string outside the
transfer set, the slice stops and the detector is designed with that evidence
in hand. If they arrive correctly categorized, the detector is not built.

## Error handling

- One bank failing never stops the others: `reconcileAll` isolates each
  connection, and this is unchanged.
- An abandoned reconnect leaves the connection's status untouched, so the
  banner keeps warning rather than reporting a repair that did not happen.
- A connect token requested for an item outside the caller's household is
  refused, not minted.
- An unrecognised Pluggy category is `SPEND`, and therefore visible in the
  inbox rather than silently excluded from every figure.

## Testing

Integration tests only, against a real PostgreSQL instance, per the parent
spec.

1. **Invoice payment on checking.** A payment observed on a checking account
   does not double-count against any budget. The parent spec's required case
   2, which until now existed only card-side.
2. **Salary.** Money arriving in checking neither offsets a budget nor
   appears in the inbox.
3. **Estorno.** A card refund still reduces its category — the guard against
   an over-broad income list.
4. **Two connections.** Dashboard totals span both; `reconcileAll` syncs
   both; one failing connection still leaves the other synced and alerted.
5. **Role reconciliation.** `refreshBudgetRoles` moves rows `SPEND→INCOME`,
   `INCOME→SPEND` and `TRANSFER→SPEND`, and ignores `category_source`
   entirely, `MANUAL` included.
6. **List agreement.** The SQL and TypeScript income lists match, extending
   the existing transfer-list assertion.
7. **Token guard.** Minting a connect token for another household's item is
   refused.
8. **Removal scope.** Removing a connection deletes its transactions and
   leaves the other connection's untouched.
9. **New account.** An account appearing on an already-connected item is
   picked up by the next `syncConnection`.
10. **Override durability.** A due-day override survives a subsequent sync.

## Risks

- **The income list is drawn from one household's connectors.** A category
  string this household never sees is a category the classifier treats as
  spend. That is the safe direction — visible in the inbox rather than
  silently excluded — and the nightly `refreshBudgetRoles` corrects the
  back-catalogue as soon as the list grows.
- **A reimbursement categorized as income is excluded rather than offsetting
  the category it repays.** Accepted for v1: it leaves the budget reading
  high, which is the direction that prompts a look rather than false comfort.
- **Removal is irreversible and cascades.** Mitigated by the confirmation,
  not eliminated. Re-adding the connection re-syncs whatever Pluggy still
  returns, which is not the same as a restore.
