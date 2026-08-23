# Hardening (Slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both cards and both checking accounts flow into one household ledger with every real counted once, and a broken connection can be repaired from the screen the stale banner points to.

**Architecture:** The two new exclusions — the invoice payment leaving checking and the salary arriving in it — are the same question, so they become one three-way `budget_role` enum written by one pure classifier and read as `budget_role = 'SPEND'` by every consumer. The connections screen is an ordinary settings route following `settings/rules`, and reconnecting is Pluggy's existing update-mode connect token with a household guard in front of it.

**Tech Stack:** TypeScript, Next.js 15 (App Router), React 19, PostgreSQL, Drizzle ORM, Auth.js v5, Vitest, Testcontainers, MSW, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-23-hardening-design.md`

**Predecessor specs:** `docs/superpowers/specs/2026-08-23-alerts-design.md`, `docs/superpowers/specs/2026-08-23-budgets-design.md`, `docs/superpowers/specs/2026-08-23-categorization-design.md`, `docs/superpowers/specs/2026-08-22-live-finance-management-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Money is integer centavos.** `bigint` with Drizzle `mode: 'number'`. No floating point in the money path. Divide only for display, at the edge.
- **All calendar bucketing uses `America/Sao_Paulo`,** through `saoPauloPeriod(now)` / `saoPauloToday(now)` in `lib/domain/dates.ts`. `transaction.date` is bucketed at ingest — never re-apply a timezone to a stored date.
- **Read-only.** No code path initiates a payment, transfer, or any money movement.
- **Integration tests only.** No separate unit-test layer and no second runner: everything runs under `pnpm test` against a real PostgreSQL instance via Testcontainers. Asserting a pure function directly inside that suite is fine; a mocked database is not.
- **Household scoping lives in `lib/db/`,** not at call sites.
- **`MANUAL` category source is never overwritten** by any sync or backfill. `budget_role` is the one thing that ignores `category_source` entirely — whether a row is an invoice payment has nothing to do with who set its category.
- **An unrecognised Pluggy category is `SPEND`.** It goes to the inbox, where it is visible, never silently excluded from every figure.
- **Do NOT modify `tests/fixtures/pluggy/transactions.json`** — `tests/ledger-view.test.ts` and others assert its exact contents. Use `tests/helpers/transactions.ts` for other shapes.
- **Do NOT run `pnpm db:migrate`** — it points at the user's real development database. `pnpm db:generate` is fine (it only writes SQL files). The test suite applies migrations itself against a throwaway Testcontainers instance.
- **Alerts must never fail a sync.** Every call into `lib/alerts/` from a sync path stays wrapped in try/catch.
- **No feature belonging to a later slice.** No pairing detector (unless Task 1 says otherwise), no connection archiving, no category detail screen, no uncategorized nudge, no alert preferences.

## File Structure

**Created:**
- `scripts/dump-categories.ts` — throwaway verification script, deleted at the end of Task 1.
- `lib/domain/budget-role.ts` — the pure three-way classifier. Replaces `lib/domain/transfers.ts`.
- `lib/sync/accounts.ts` — `refreshAccounts`, extracted from `attachConnection` so every sync picks up a new account.
- `app/(app)/settings/connections/page.tsx`, `actions.ts`, `state.ts`, `ConnectionForms.tsx` — the screen.
- `components/ConnectBankButton.tsx` — replaces `components/ConnectCardButton.tsx`, adds update mode.
- `drizzle/0009_budget_role.sql`, `drizzle/0010_day_overrides.sql` — generated, then hand-edited for the backfill.
- `tests/budget-role.test.ts` (replaces `tests/transfers.test.ts`), `tests/budget-roles-db.test.ts` (replaces `tests/transfer-flags.test.ts`), `tests/checking-accounts.test.ts`, `tests/connections-page.test.ts`, `tests/connection-actions.test.ts`.

**Modified:**
- `lib/db/schema.ts` — `budget_role` enum and column, `due_day_override`, `closing_day_override`.
- `lib/pluggy/mapper.ts` — writes `budgetRole`.
- `lib/sync/transfers.ts` → `lib/sync/budget-roles.ts` — `refreshTransferFlags` becomes `refreshBudgetRoles`.
- `lib/sync/connect.ts`, `lib/sync/transactions.ts`, `lib/sync/reconcile.ts` — `refreshAccounts` and the rename.
- `lib/views/spend.ts`, `lib/views/inbox.ts`, `lib/views/forward.ts`, `lib/views/budget-editor.ts`, `lib/views/ledger.ts`, `lib/db/transactions.ts` — the `budget_role = 'SPEND'` predicate.
- `lib/db/connections.ts` — connection-with-accounts read, item lookup, delete, override writes.
- `app/api/pluggy/connect-token/route.ts` — optional `itemId`, household-guarded.
- `app/(app)/layout.tsx`, `app/(app)/ledger/page.tsx`, `components/StaleBanner.tsx` — navigation to the new screen.
- `tests/helpers/transactions.ts` — `seedAccount` takes an account type.
- `app/globals.css` — styles for the new rows.

---

### Task 1: Verify the category strings against live data

The classifier's income list decides what stops counting as spend. Written from documentation it is a guess; written from the household's own connectors it is a fact. This task also decides whether the pairing detector is needed at all, so nothing after it is designed on an assumption.

**Files:**
- Create: `scripts/dump-categories.ts` (deleted in Step 5)

**Interfaces:**
- Consumes: `createPluggyClient` from `lib/pluggy/client.ts`, `createDb` from `lib/db/client.ts`.
- Produces: two lists of category strings, recorded in this task's findings note and consumed verbatim by Task 2.

- [ ] **Step 1: Write the script**

Create `scripts/dump-categories.ts`:

```ts
/**
 * THROWAWAY. Reads the live connections and reports which Pluggy category
 * strings actually arrive, by account type. Deleted at the end of Task 1;
 * its output lives on in the doc comment of lib/domain/budget-role.ts.
 *
 * Read-only: it issues GETs and writes nothing.
 */
import { createDb } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'
import { loadEnv } from '@/lib/env'
import { createPluggyClient } from '@/lib/pluggy/client'

const env = loadEnv()
const { db } = createDb(env.DATABASE_URL)
const pluggy = createPluggyClient({
  apiUrl: env.PLUGGY_API_URL,
  clientId: env.PLUGGY_CLIENT_ID,
  clientSecret: env.PLUGGY_CLIENT_SECRET,
})

type Row = { count: number; totalCents: number; credits: number }
const seen = new Map<string, Row>()

for (const account of await db.select().from(accounts)) {
  const remote = await pluggy.listTransactions(account.pluggyAccountId)
  for (const tx of remote) {
    const key = `${account.type}\t${tx.category ?? '(none)'}`
    const row = seen.get(key) ?? { count: 0, totalCents: 0, credits: 0 }
    row.count += 1
    row.totalCents += Math.round(Math.abs(tx.amountInAccountCurrency ?? tx.amount) * 100)
    if (tx.type === 'CREDIT') row.credits += 1
    seen.set(key, row)
  }
}

const sorted = [...seen.entries()].sort((a, b) => b[1].totalCents - a[1].totalCents)
console.log(['ACCOUNT_TYPE', 'CATEGORY', 'COUNT', 'CREDITS', 'TOTAL_BRL'].join('\t'))
for (const [key, row] of sorted) {
  console.log([key, row.count, row.credits, (row.totalCents / 100).toFixed(2)].join('\t'))
}
process.exit(0)
```

- [ ] **Step 2: Run it against the live database**

Run: `pnpm tsx scripts/dump-categories.ts`

This reads `.env.local`, so it hits the real Pluggy connections. It writes nothing. Expected: a tab-separated table, largest categories first, with `BANK` and `CREDIT` rows.

- [ ] **Step 3: Read the three answers out of the output**

1. **Income strings.** Every `BANK` category whose rows are overwhelmingly `CREDIT` and which is money arriving rather than a refund — salary, retirement, investment redemption, interest. Write them down; they become `INCOME_PLUGGY_CATEGORIES` in Task 2.
2. **Invoice payments on the checking side.** Find the debits that pay the card invoices. Confirm their category is already in the transfer set (`Credit card payment`, `Transfers`, `Tax on financial operations`, `Credit card fees`).
3. **Near-misses.** Any `BANK` category not in `PLUGGY_CATEGORY_TO_SEED_KEY` and not income — those belong in that map, and `tests/pluggy-category-coverage.test.ts` is where the string goes first.

- [ ] **Step 4: Gate — decide whether the plan continues as written**

If step 3.2 shows the checking-side invoice payments arriving under a category **outside** the transfer set, or uncategorized: **stop here and report it.** The spec's contingency applies — the pairing detector needs designing with this evidence, and Tasks 2–3 change shape. Do not improvise a detector.

If they arrive correctly categorized: continue. Task 2's income list is now the one from step 3.1, not the provisional one in this plan.

- [ ] **Step 5: Delete the script and record the findings**

```bash
rm scripts/dump-categories.ts
```

Nothing is committed by this task. The findings travel into Task 2's doc comment and commit message, the way `lib/domain/transfers.ts` and `lib/domain/pluggy-categories.ts` already record what was read off live data.

---

### Task 2: The three-way classifier

The whole decision, pure, no I/O. Everything after this consumes it.

**Files:**
- Create: `lib/domain/budget-role.ts`
- Delete: `lib/domain/transfers.ts`
- Create: `tests/budget-role.test.ts`
- Delete: `tests/transfers.test.ts`

**Interfaces:**
- Consumes: the category lists from Task 1.
- Produces, from `lib/domain/budget-role.ts`:
  - `type BudgetRole = 'SPEND' | 'TRANSFER' | 'INCOME'`
  - `const TRANSFER_PLUGGY_CATEGORIES: ReadonlySet<string>`
  - `const INCOME_PLUGGY_CATEGORIES: ReadonlySet<string>`
  - `function classifyRole(pluggyCategory: string | null | undefined): BudgetRole`

- [ ] **Step 1: Write the failing tests**

Create `tests/budget-role.test.ts`. Replace the four income literals with the strings Task 1 observed if they differ:

```ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  classifyRole,
  INCOME_PLUGGY_CATEGORIES,
  TRANSFER_PLUGGY_CATEGORIES,
} from '@/lib/domain/budget-role'

it('classifies the four categories that are money moving, not spending', () => {
  expect(classifyRole('Credit card payment')).toBe('TRANSFER')
  expect(classifyRole('Transfers')).toBe('TRANSFER')
  expect(classifyRole('Tax on financial operations')).toBe('TRANSFER')
  expect(classifyRole('Credit card fees')).toBe('TRANSFER')
})

it('classifies money arriving as income', () => {
  for (const category of INCOME_PLUGGY_CATEGORIES) {
    expect(classifyRole(category)).toBe('INCOME')
  }
  expect(INCOME_PLUGGY_CATEGORIES.size).toBeGreaterThan(0)
})

it('classifies ordinary spending as spending', () => {
  expect(classifyRole('Groceries')).toBe('SPEND')
  expect(classifyRole('Eating out')).toBe('SPEND')
  expect(classifyRole('Vehicle maintenance')).toBe('SPEND')
})

it('treats an absent category as spending rather than guessing', () => {
  // A transaction Pluggy could not categorize belongs in the inbox, where it
  // is visible -- not silently excluded from every total.
  expect(classifyRole(null)).toBe('SPEND')
  expect(classifyRole(undefined)).toBe('SPEND')
  expect(classifyRole('')).toBe('SPEND')
})

it('keeps income and transfer disjoint', () => {
  // Both exclude a row from the budget, but they are not interchangeable:
  // a string in both sets means classifyRole's precedence decides silently.
  for (const category of INCOME_PLUGGY_CATEGORIES) {
    expect(TRANSFER_PLUGGY_CATEGORIES.has(category)).toBe(false)
  }
})

it('keeps the 0006 backfill in step with the transfer set it copies', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const sql = readFileSync(join(root, 'drizzle/0006_budgets.sql'), 'utf8')
  const backfill = sql.slice(sql.indexOf('UPDATE "transaction" SET "is_transfer" = true'))

  expect(backfill).not.toBe('')
  for (const category of TRANSFER_PLUGGY_CATEGORIES) {
    expect(backfill).toContain(`'${category}'`)
  }
})
```

The 0009 counterpart of that last test is written in Task 3, once the migration exists.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/budget-role.test.ts`
Expected: FAIL — cannot resolve `@/lib/domain/budget-role`.

- [ ] **Step 3: Write the classifier**

Create `lib/domain/budget-role.ts`. Copy the existing doc comment from `lib/domain/transfers.ts` — it records real-data verification and is the reason the transfer set is trusted — and add the income findings from Task 1 beneath it:

```ts
/**
 * What a transaction is, for budgeting purposes.
 *
 * SPEND is the default and the fallback. An unrecognised category is NOT an
 * exclusion: a transaction Pluggy could not categorize belongs in the inbox,
 * where it is visible, rather than being silently dropped from every figure.
 *
 * VERIFIED AGAINST REAL DATA: the four transfer strings were read off a live
 * card statement, not taken from documentation. On that connection they cover
 * 113 transactions, including R$177,174.79 of 'Credit card payment' -- the
 * invoices the household has paid, which appear on the card as credits. Left
 * in, they make every total wrong by the value of every invoice ever paid.
 *
 * The income strings were read the same way, off the live checking accounts
 * (Task 1 of the Slice 6 plan). They matter for the opposite reason: on a
 * card a CREDIT is an estorno and correctly reduces category spend, but on
 * checking a CREDIT is salary, and left in it would credit thousands of reais
 * against a budget.
 *
 * BOTH SETS ARE DUPLICATED IN SQL. drizzle/0006_budgets.sql backfills the
 * transfer rows and drizzle/0009_budget_role.sql backfills the income rows,
 * because the nightly refreshBudgetRoles pass is up to 24 hours away at
 * deploy time and every figure is wrong until it runs. Adding a category here
 * corrects new and re-synced rows only -- rows already in the database need a
 * new migration. tests/budget-role.test.ts asserts the lists and the SQL
 * agree, so a silent divergence fails the suite rather than the household's
 * totals.
 */
export type BudgetRole = 'SPEND' | 'TRANSFER' | 'INCOME'

export const TRANSFER_PLUGGY_CATEGORIES: ReadonlySet<string> = new Set([
  'Credit card payment',
  'Transfers',
  'Tax on financial operations',
  'Credit card fees',
])

export const INCOME_PLUGGY_CATEGORIES: ReadonlySet<string> = new Set([
  'Salary',
  'Retirement',
  'Interest income',
  'Investment redemption',
])

export function classifyRole(pluggyCategory: string | null | undefined): BudgetRole {
  if (!pluggyCategory) return 'SPEND'
  if (TRANSFER_PLUGGY_CATEGORIES.has(pluggyCategory)) return 'TRANSFER'
  if (INCOME_PLUGGY_CATEGORIES.has(pluggyCategory)) return 'INCOME'
  return 'SPEND'
}
```

**Replace the four income strings with Task 1's observed list.** The ones above are Pluggy's published taxonomy, which the categorization slice already learned covers only about a third of what a real connector emits.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/budget-role.test.ts`
Expected: PASS, six tests.

- [ ] **Step 5: Delete the predecessor**

`lib/domain/transfers.ts` still exists and is still imported by `lib/pluggy/mapper.ts` and `lib/sync/transfers.ts`; Task 3 moves those. Leave the file in place for now — deleting it here breaks the build mid-task — and delete `tests/transfers.test.ts`, whose every case is now covered above:

```bash
rm tests/transfers.test.ts
```

- [ ] **Step 6: Run the whole suite**

Run: `pnpm test`
Expected: PASS. Nothing consumes the new module yet.

- [ ] **Step 7: Commit**

```bash
git add lib/domain/budget-role.ts tests/budget-role.test.ts
git rm tests/transfers.test.ts
git commit -m "feat: classify a transaction as spend, transfer or income"
```

Put the observed income strings and their volumes in the commit body, so the evidence is in the history and not only in a comment.

---

### Task 3: The budget_role column

One enum replaces one boolean across the schema, the mapper, the nightly pass and every read. The suite is the safety net: eight call sites, and a missed one does not compile.

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/0009_budget_role.sql` (generated, then hand-edited)
- Modify: `lib/pluggy/mapper.ts:5,29`
- Modify: `lib/sync/transactions.ts:56`
- Rename: `lib/sync/transfers.ts` → `lib/sync/budget-roles.ts`
- Modify: `lib/sync/reconcile.ts`
- Modify: `lib/views/spend.ts:58`, `lib/views/inbox.ts:38,77`, `lib/views/forward.ts:76`, `lib/views/budget-editor.ts:54`
- Modify: `lib/db/transactions.ts:18,37,65`, `lib/views/ledger.ts`, `app/(app)/ledger/page.tsx`
- Delete: `lib/domain/transfers.ts`
- Rename: `tests/transfer-flags.test.ts` → `tests/budget-roles-db.test.ts`
- Modify: `tests/budget-role.test.ts` (the 0009 assertion)

**Interfaces:**
- Consumes: `classifyRole`, `BudgetRole`, `INCOME_PLUGGY_CATEGORIES` from `lib/domain/budget-role.ts`.
- Produces:
  - `transactions.budgetRole` column, and `budgetRoleEnum` from `lib/db/schema.ts`
  - `refreshBudgetRoles(exec: Executor, householdId: string): Promise<{ changed: number }>` from `lib/sync/budget-roles.ts`
  - `listTransactions(db, householdId, opts: { from?: string; to?: string; includeExcluded?: boolean })` — the option is renamed
  - `TransactionRow.budgetRole: BudgetRole` replacing `TransactionRow.isTransfer: boolean`

- [ ] **Step 1: Write the failing tests**

Rename the existing file and rewrite it against roles:

```bash
git mv tests/transfer-flags.test.ts tests/budget-roles-db.test.ts
```

Replace its contents:

```ts
import { eq } from 'drizzle-orm'
import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { connections, transactions } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { refreshBudgetRoles } from '@/lib/sync/budget-roles'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

async function seedHousehold() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution: 'Nubank',
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, connection.id)
  return { db, householdId, accountId }
}

async function roleOf(db: ReturnType<typeof testDb>, householdId: string, id: string) {
  const rows = await listTransactions(db, householdId, { includeExcluded: true })
  return rows.find((r) => r.id === id)!.budgetRole
}

it('assigns each role from the category, and leaves spending alone', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const payment = await insertTransaction(db, accountId, {
    description: 'PAGAMENTO FATURA',
    amountCents: -177_174_79,
    pluggyCategory: 'Credit card payment',
  })
  const salary = await insertTransaction(db, accountId, {
    description: 'SALARIO',
    amountCents: -1_200_000,
    pluggyCategory: 'Salary',
  })
  const groceries = await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    pluggyCategory: 'Groceries',
  })

  const { changed } = await refreshBudgetRoles(db, householdId)

  expect(changed).toBe(2)
  expect(await roleOf(db, householdId, payment)).toBe('TRANSFER')
  expect(await roleOf(db, householdId, salary)).toBe('INCOME')
  expect(await roleOf(db, householdId, groceries)).toBe('SPEND')
})

it('moves a row back to spending when its category stops being an exclusion', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const id = await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    pluggyCategory: 'Groceries',
  })
  await db.update(transactions).set({ budgetRole: 'INCOME' }).where(eq(transactions.id, id))

  const { changed } = await refreshBudgetRoles(db, householdId)

  expect(changed).toBe(1)
  expect(await roleOf(db, householdId, id)).toBe('SPEND')
})

it('re-roles a hand-categorized row too, which recategorize could never do', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const id = await insertTransaction(db, accountId, {
    description: 'PAGAMENTO FATURA',
    pluggyCategory: 'Credit card payment',
  })
  // Whether a row is an invoice payment has nothing to do with who set its
  // category, so this pass has no MANUAL exclusion at all.
  await db.update(transactions).set({ categorySource: 'MANUAL' }).where(eq(transactions.id, id))

  await refreshBudgetRoles(db, householdId)

  expect(await roleOf(db, householdId, id)).toBe('TRANSFER')
})

it('leaves another household alone', async () => {
  const { db, householdId } = await seedHousehold()
  const other = await seedHousehold()
  await insertTransaction(other.db, other.accountId, {
    description: 'PAGAMENTO FATURA',
    pluggyCategory: 'Credit card payment',
  })

  const { changed } = await refreshBudgetRoles(db, householdId)

  expect(changed).toBe(0)
})
```

Add the 0009 assertion to `tests/budget-role.test.ts`:

```ts
it('keeps the 0009 backfill in step with the income set it copies', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const sql = readFileSync(join(root, 'drizzle/0009_budget_role.sql'), 'utf8')
  const backfill = sql.slice(sql.indexOf(`UPDATE "transaction" SET "budget_role" = 'INCOME'`))

  expect(backfill).not.toBe('')
  for (const category of INCOME_PLUGGY_CATEGORIES) {
    expect(backfill).toContain(`'${category}'`)
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/budget-roles-db.test.ts tests/budget-role.test.ts`
Expected: FAIL — no `@/lib/sync/budget-roles`, no `drizzle/0009_budget_role.sql`.

- [ ] **Step 3: Add the column to the schema**

In `lib/db/schema.ts`, beside the other enums:

```ts
export const budgetRoleEnum = pgEnum('budget_role', ['SPEND', 'TRANSFER', 'INCOME'])
```

In the `transactions` table, replace the `isTransfer` field with:

```ts
    // What this row is, for budgeting: spending, money moving between the
    // household's own accounts, or money arriving. Only SPEND counts against
    // a budget. See lib/domain/budget-role.ts.
    budgetRole: budgetRoleEnum('budget_role').notNull().default('SPEND'),
```

- [ ] **Step 4: Generate the migration and hand-edit the backfill**

Run: `pnpm db:generate`

This writes `drizzle/0009_*.sql` containing the `CREATE TYPE`, the `ADD COLUMN` and the `DROP COLUMN`. Rename it to `drizzle/0009_budget_role.sql` if drizzle-kit chose another suffix, updating `drizzle/meta/_journal.json` to match.

Then hand-edit it so the backfill runs **between** the add and the drop — the generated file has no backfill at all, and applied as generated it silently resets every invoice payment to `SPEND`:

```sql
CREATE TYPE "public"."budget_role" AS ENUM('SPEND', 'TRANSFER', 'INCOME');--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "budget_role" "budget_role" DEFAULT 'SPEND' NOT NULL;--> statement-breakpoint

-- Carry the boolean across before dropping it. refreshBudgetRoles would
-- eventually do this, but it is up to 24 hours away at deploy time and every
-- figure is wrong until it runs.
UPDATE "transaction" SET "budget_role" = 'TRANSFER' WHERE "is_transfer" = true;--> statement-breakpoint

-- Income has never had a column, so there is nothing to carry: these rows are
-- classified here for the first time. The list is duplicated from
-- INCOME_PLUGGY_CATEGORIES in lib/domain/budget-role.ts and
-- tests/budget-role.test.ts asserts the two agree.
UPDATE "transaction" SET "budget_role" = 'INCOME'
  WHERE "pluggy_category" IN ('Salary', 'Retirement', 'Interest income', 'Investment redemption');--> statement-breakpoint

ALTER TABLE "transaction" DROP COLUMN "is_transfer";
```

Use Task 1's income strings, matching `INCOME_PLUGGY_CATEGORIES` exactly.

- [ ] **Step 5: Move the classifier onto the write path**

`lib/pluggy/mapper.ts` — replace the import and the field:

```ts
import { classifyRole } from '@/lib/domain/budget-role'
```

```ts
    budgetRole: classifyRole(remote.category ?? null),
```

`lib/sync/transactions.ts:56` — in the `onConflictDoUpdate` set:

```ts
            budgetRole: row.budgetRole,
```

Then delete the predecessor module:

```bash
git rm lib/domain/transfers.ts
```

- [ ] **Step 6: Rewrite the nightly pass**

```bash
git mv lib/sync/transfers.ts lib/sync/budget-roles.ts
```

Replace its contents. The two properties its predecessor's comment defends are kept, and the two-statement shape becomes one statement per role:

```ts
import { and, inArray, isNull, ne, notInArray, or, type SQL } from 'drizzle-orm'
import type { Executor } from '@/lib/db/client'
import { householdTransactionIds } from '@/lib/db/transactions'
import { transactions } from '@/lib/db/schema'
import {
  type BudgetRole,
  INCOME_PLUGGY_CATEGORIES,
  TRANSFER_PLUGGY_CATEGORIES,
} from '@/lib/domain/budget-role'

/**
 * Brings `budget_role` into line with the household's transactions.
 *
 * This is deliberately NOT part of recategorize. That function excludes
 * MANUAL rows in its query predicate -- the guarantee Slice 2 exists to make
 * -- but whether a row is an invoice payment or a salary has nothing to do
 * with who set its category. A hand-categorized invoice payment must still be
 * excluded, so this pass has no MANUAL exclusion at all.
 *
 * It also moves rows back: a row whose category stopped being an exclusion
 * becomes spending again. That is what makes it safe to run nightly rather
 * than once, and what lets an extended category list land without a
 * migration.
 */
export async function refreshBudgetRoles(
  exec: Executor,
  householdId: string,
): Promise<{ changed: number }> {
  const transfer = [...TRANSFER_PLUGGY_CATEGORIES]
  const income = [...INCOME_PLUGGY_CATEGORIES]
  const excluded = [...transfer, ...income]

  async function setRole(role: BudgetRole, match: SQL | undefined) {
    const rows = await exec
      .update(transactions)
      .set({ budgetRole: role, updatedAt: new Date() })
      .where(
        and(
          inArray(transactions.id, householdTransactionIds(exec, householdId)),
          // Only rows whose role is actually wrong, so a nightly no-op costs
          // no writes and the returned count is honest.
          ne(transactions.budgetRole, role),
          match,
        ),
      )
      .returning({ id: transactions.id })
    return rows.length
  }

  const flaggedTransfer = await setRole('TRANSFER', inArray(transactions.pluggyCategory, transfer))
  const flaggedIncome = await setRole('INCOME', inArray(transactions.pluggyCategory, income))
  // A NULL category is spending, and `NOT (null IN (...))` is NULL rather
  // than true -- so it needs saying explicitly.
  const flaggedSpend = await setRole(
    'SPEND',
    or(isNull(transactions.pluggyCategory), notInArray(transactions.pluggyCategory, excluded)),
  )

  return { changed: flaggedTransfer + flaggedIncome + flaggedSpend }
}
```

`lib/sync/reconcile.ts` — update the import and call, and the comment that names the old function:

```ts
import { refreshBudgetRoles } from './budget-roles'
```

```ts
      const { changed: roled } = await refreshBudgetRoles(db, householdId)
      transfersFlagged += roled
```

Rename the returned counter `transfersFlagged` to `rolesCorrected` throughout `reconcileAll` and in `reconcile-job.ts` / `app/api/cron/reconcile/route.ts` wherever it is logged, so the log says what it now means.

- [ ] **Step 7: Switch every read**

Replace `eq(transactions.isTransfer, false)` with `eq(transactions.budgetRole, 'SPEND')` in:

- `lib/views/spend.ts:58` — the comment above it becomes `// Only spending counts: not invoice payments, not salary.`
- `lib/views/inbox.ts:38` and `:77`
- `lib/views/forward.ts:76`
- `lib/views/budget-editor.ts:54`

In `lib/db/transactions.ts`:

```ts
  budgetRole: BudgetRole
```

```ts
  opts: { from?: string; to?: string; includeExcluded?: boolean } = {},
```

```ts
  // Invoice payments, fees and income are not spending. Callers that want
  // them -- the ledger's "show everything" toggle -- ask explicitly.
  if (!opts.includeExcluded) filters.push(eq(transactions.budgetRole, 'SPEND'))
```

```ts
    budgetRole: transaction.budgetRole,
```

with `import type { BudgetRole } from '@/lib/domain/budget-role'` at the top.

In `lib/views/ledger.ts`, rename `includeTransfers` to `includeExcluded` and `includingTransfers` to `includingExcluded` in `LedgerView` and `getLedgerView`. In `app/(app)/ledger/page.tsx`, keep the `?transfers=1` URL parameter — it is a bookmarkable URL and renaming it buys nothing — but pass it as `includeExcluded` and relabel the link `Show transfers and income` / `Hide transfers and income`.

- [ ] **Step 8: Run the whole suite and fix the fallout**

Run: `pnpm test`

Expected: several files fail on `isTransfer` — `tests/dashboard-view.test.ts`, `tests/forward-view.test.ts`, `tests/alerts.test.ts`, `tests/reconcile.test.ts`, `tests/pluggy-v2.test.ts`, `tests/pluggy-category-coverage.test.ts`. Each is a mechanical rename: `isTransfer: true` becomes `budgetRole: 'TRANSFER'`, `expect(row.isTransfer).toBe(false)` becomes `expect(row.budgetRole).toBe('SPEND')`, `includeTransfers` becomes `includeExcluded`. Do not weaken an assertion to make it pass — if one fails on meaning rather than naming, that is a real defect in Steps 5–7.

Run until green: `pnpm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: replace is_transfer with a three-way budget role"
```

---

### Task 4: Checking accounts and a second connection

The arithmetic the slice exists for, proved. This task writes tests first against the code Task 3 just landed; if one fails, the defect is real and gets fixed here.

**Files:**
- Modify: `tests/helpers/transactions.ts`
- Create: `tests/checking-accounts.test.ts`

**Interfaces:**
- Consumes: `refreshBudgetRoles` from `lib/sync/budget-roles.ts`, `getCategorySpend` from `lib/views/spend.ts`, `countUncategorized` from `lib/views/inbox.ts`.
- Produces: `seedAccount(db, connectionId, over: { pluggyAccountId?, name?, type?: 'CREDIT' | 'BANK' })` — the helper gains an account type.

- [ ] **Step 1: Teach the helper about checking accounts**

In `tests/helpers/transactions.ts`:

```ts
export async function seedAccount(
  db: Db,
  connectionId: string,
  over: { pluggyAccountId?: string; name?: string; type?: 'CREDIT' | 'BANK' } = {},
): Promise<string> {
  const [row] = await db
    .insert(accounts)
    .values({
      connectionId,
      pluggyAccountId: over.pluggyAccountId ?? `acc-${crypto.randomUUID()}`,
      type: over.type ?? 'CREDIT',
      name: over.name ?? 'Card',
      last4: '9999',
    })
    .returning({ id: accounts.id })
  return row.id
}
```

`insertTransaction` needs no change: it already takes `pluggyCategory` and a signed `amountCents`, which is everything these cases need.

- [ ] **Step 2: Write the failing tests**

Create `tests/checking-accounts.test.ts`:

```ts
import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { refreshBudgetRoles } from '@/lib/sync/budget-roles'
import { getCategorySpend } from '@/lib/views/spend'
import { countUncategorized } from '@/lib/views/inbox'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

async function seedHousehold() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  return { db, householdId, userId }
}

async function addConnection(
  db: ReturnType<typeof testDb>,
  householdId: string,
  userId: string,
  institution: string,
) {
  const [row] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution,
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  return row.id
}

const PERIOD = '2026-08'
const TODAY = '2026-08-20'

it('does not count a card invoice paid from checking as spending', async () => {
  // The required case from the parent spec: the invoice payment leaving
  // checking is the same money as the card transactions it settles. Counted,
  // it doubles the month.
  const { db, householdId, userId } = await seedHousehold()
  const card = await seedAccount(db, await addConnection(db, householdId, userId, 'Nubank'))
  const checking = await seedAccount(
    db,
    await addConnection(db, householdId, userId, 'Itau'),
    { type: 'BANK', name: 'Conta' },
  )

  await insertTransaction(db, card, {
    description: 'ZAFFARI',
    amountCents: 50_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  await insertTransaction(db, checking, {
    description: 'PAGAMENTO FATURA NUBANK',
    amountCents: 50_000,
    date: '2026-08-10',
    pluggyCategory: 'Credit card payment',
  })
  await refreshBudgetRoles(db, householdId)

  const spend = await getCategorySpend(db, householdId, PERIOD, TODAY)
  const total = spend.reduce((sum, row) => sum + row.spentCents, 0)

  expect(total).toBe(50_000)
})

it('does not let salary offset a budget, and keeps it out of the inbox', async () => {
  const { db, householdId, userId } = await seedHousehold()
  const checking = await seedAccount(
    db,
    await addConnection(db, householdId, userId, 'Itau'),
    { type: 'BANK', name: 'Conta' },
  )

  await insertTransaction(db, checking, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  // Money in is a CREDIT, so it reaches the ledger as a negative amount.
  await insertTransaction(db, checking, {
    description: 'SALARIO',
    amountCents: -1_200_000,
    date: '2026-08-05',
    pluggyCategory: 'Salary',
  })
  await refreshBudgetRoles(db, householdId)

  const spend = await getCategorySpend(db, householdId, PERIOD, TODAY)
  const total = spend.reduce((sum, row) => sum + row.spentCents, 0)

  expect(total).toBe(30_000)
  // Asking the household to categorize its own salary is noise.
  expect(await countUncategorized(db, householdId)).toBe(0)
})

it('still lets a card refund reduce the category it was bought in', async () => {
  // The guard against an over-broad income list: an estorno is SPEND, and
  // reducing its category is the correct behaviour, not a bug to exclude.
  const { db, householdId, userId } = await seedHousehold()
  const card = await seedAccount(db, await addConnection(db, householdId, userId, 'Nubank'))

  await insertTransaction(db, card, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  await insertTransaction(db, card, {
    description: 'ESTORNO ZAFFARI',
    amountCents: -10_000,
    date: '2026-08-06',
    pluggyCategory: 'Groceries',
  })
  await refreshBudgetRoles(db, householdId)

  const spend = await getCategorySpend(db, householdId, PERIOD, TODAY)
  const total = spend.reduce((sum, row) => sum + row.spentCents, 0)

  expect(total).toBe(20_000)
})

it('totals spend across both connections in the household', async () => {
  const { db, householdId, userId } = await seedHousehold()
  const hers = await seedAccount(db, await addConnection(db, householdId, userId, 'Nubank'))
  const his = await seedAccount(db, await addConnection(db, householdId, userId, 'Itau'))

  await insertTransaction(db, hers, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  await insertTransaction(db, his, {
    description: 'ZAFFARI',
    amountCents: 20_000,
    date: '2026-08-06',
    pluggyCategory: 'Groceries',
  })
  await refreshBudgetRoles(db, householdId)

  const spend = await getCategorySpend(db, householdId, PERIOD, TODAY)
  const total = spend.reduce((sum, row) => sum + row.spentCents, 0)

  expect(total).toBe(50_000)
})
```

Check `lib/views/inbox.ts` for the exact export name before writing the import: if the count is exposed as something other than `countUncategorized`, use that.

- [ ] **Step 3: Run the tests**

Run: `pnpm vitest run tests/checking-accounts.test.ts`
Expected: PASS if Task 3 is correct. A failure here is a real defect — fix the source, not the test.

- [ ] **Step 4: Confirm reconcileAll already isolates a failing connection**

`tests/reconcile.test.ts` already asserts `succeeded` and `failed` across connections. Read it and confirm the case exists with two connections where one fails. If it only has one connection, add a case with two, asserting the healthy one still syncs and its household is still alerted.

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/checking-accounts.test.ts tests/helpers/transactions.ts tests/reconcile.test.ts
git commit -m "test: prove checking accounts and a second connection count once"
```

---

### Task 5: Pick up new accounts on every sync

Accounts are read from Pluggy exactly once, at connect time. Open a checking account on a bank login already connected and it never appears — and this slice is precisely about connecting checking accounts to logins that already exist.

**Files:**
- Create: `lib/sync/accounts.ts`
- Modify: `lib/sync/connect.ts`, `lib/sync/transactions.ts`
- Modify: `tests/sync-transactions.test.ts`

**Interfaces:**
- Consumes: `PluggyClient.listAccounts`, `accounts` table.
- Produces: `refreshAccounts(db: Db, pluggy: PluggyClient, connectionId: string, itemId: string): Promise<{ upserted: number }>` from `lib/sync/accounts.ts`.

- [ ] **Step 1: Write the failing test**

Add to `tests/sync-transactions.test.ts`, following the file's existing MSW and seeding style:

```ts
it('picks up an account opened on an already-connected login', async () => {
  const { db, householdId, connectionId } = await connected()

  // The same item now reports a second account. Until refreshAccounts ran on
  // every sync, this account -- and every transaction in it -- was invisible
  // until the connection was removed and re-added.
  server.use(
    http.get('https://api.pluggy.test/accounts', () =>
      HttpResponse.json({
        results: [
          ...accountsFixture.results,
          {
            id: 'acc-bank-2',
            itemId: 'item-nubank-1',
            type: 'BANK',
            name: 'Conta Poupanca',
            number: '5555',
          },
        ],
      }),
    ),
  )

  await syncConnection(db, pluggy(), connectionId)

  const rows = await listAccounts(db, householdId)
  expect(rows.map((r) => r.pluggyAccountId)).toContain('acc-bank-2')
})
```

Reuse the file's existing helpers for `connected()` and `pluggy()`; if it names them differently, follow what is there. `accountsFixture` is `tests/fixtures/pluggy/accounts.json`, and `listAccounts` comes from `@/lib/db/connections`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/sync-transactions.test.ts`
Expected: FAIL — `acc-bank-2` is absent, because `syncConnection` never asks Pluggy for accounts.

- [ ] **Step 3: Extract the upsert**

Create `lib/sync/accounts.ts` by moving the account loop and `dueDayFrom` out of `lib/sync/connect.ts` verbatim:

```ts
import type { Db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'
import type { PluggyClient } from '@/lib/pluggy/client'
import type { PluggyAccount } from '@/lib/pluggy/types'

function dueDayFrom(account: PluggyAccount): number | null {
  const date = account.creditData?.balanceDueDate
  if (!date) return null
  return Number(date.slice(8, 10))
}

/**
 * Brings the local accounts into line with what the bank login reports.
 *
 * Called on connect AND on every sync, because an account opened later on an
 * existing login would otherwise never appear -- with every transaction in
 * it. Being an upsert on pluggy_account_id, running it every sync is
 * idempotent and costs one request.
 *
 * It never deletes: an account that stops being reported keeps its history,
 * which is what the ledger is for.
 */
export async function refreshAccounts(
  db: Db,
  pluggy: PluggyClient,
  connectionId: string,
  itemId: string,
): Promise<{ upserted: number }> {
  const remoteAccounts = await pluggy.listAccounts(itemId)

  for (const remote of remoteAccounts) {
    await db
      .insert(accounts)
      .values({
        connectionId,
        pluggyAccountId: remote.id,
        type: remote.type,
        name: remote.name,
        last4: remote.number?.slice(-4) ?? null,
        dueDay: dueDayFrom(remote),
        closingDay: null,
        creditLimitCents:
          remote.creditData?.creditLimit == null
            ? null
            : Math.round(remote.creditData.creditLimit * 100),
      })
      .onConflictDoUpdate({
        target: accounts.pluggyAccountId,
        set: { name: remote.name, dueDay: dueDayFrom(remote) },
      })
  }

  return { upserted: remoteAccounts.length }
}
```

- [ ] **Step 4: Call it from both paths**

In `lib/sync/connect.ts`, delete `dueDayFrom`, the account loop and the now-unused `accounts` and `PluggyAccount` imports, and replace the loop with:

```ts
  await refreshAccounts(db, pluggy, connection.id, item.id)
```

`attachConnection` already calls `pluggy.listAccounts` before the upsert — remove that call too, since `refreshAccounts` makes it.

In `lib/sync/transactions.ts`, after the `getItem` call and before reading local accounts:

```ts
  // Before reading local accounts, not after: an account opened since the
  // last sync must be in the list this sync then walks.
  await refreshAccounts(db, pluggy, connectionId, connection.pluggyItemId)
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test`
Expected: PASS. `tests/connections.test.ts` and `tests/api-routes.test.ts` cover the connect path and prove the extraction changed nothing there.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: refresh accounts on every sync, not only on connect"
```

---

### Task 6: A connect token in update mode

Pluggy's `createConnectToken(itemId)` reopens the widget against an existing item, which is how a bank consent gets repaired. The guard in front of it is the security-relevant part of this slice: without it, any signed-in user could mint an update-mode token for any item id they can name.

**Files:**
- Modify: `app/api/pluggy/connect-token/route.ts`
- Modify: `lib/db/connections.ts`
- Modify: `tests/api-routes.test.ts`

**Interfaces:**
- Consumes: `PluggyClient.createConnectToken(itemId?)`.
- Produces: `connectionByItemId(db: Db, householdId: string, itemId: string): Promise<Connection | null>` from `lib/db/connections.ts`.

- [ ] **Step 1: Write the failing tests**

`tests/api-routes.test.ts` currently calls `connectTokenPost()` with no arguments. The route is about to take a `Request`, so **every existing call in that file needs one** — including the 401 case. Update them to `connectTokenPost(jsonRequest('https://app.test/api/pluggy/connect-token', {}))` and add:

```ts
it('mints an update-mode token for an item in the caller session household', async () => {
  const { db, householdId, userId } = await signedIn()
  await db.insert(connections).values({
    householdId,
    ownerUserId: userId,
    pluggyItemId: 'item-nubank-1',
    institution: 'Nubank',
    status: 'LOGIN_ERROR',
  })

  const response = await connectTokenPost(
    jsonRequest('https://app.test/api/pluggy/connect-token', { itemId: 'item-nubank-1' }),
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ accessToken: 'connect-token-abc' })
})

it('refuses an update-mode token for another household item', async () => {
  // Without this the item id is the only thing standing between a signed-in
  // user and a token that reopens someone else's bank connection.
  const { db } = await signedIn()
  const other = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })
  await db.insert(connections).values({
    householdId: other.householdId,
    ownerUserId: other.userId,
    pluggyItemId: 'item-theirs-1',
    institution: 'Itau',
    status: 'UPDATED',
  })

  const response = await connectTokenPost(
    jsonRequest('https://app.test/api/pluggy/connect-token', { itemId: 'item-theirs-1' }),
  )

  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'UNKNOWN_CONNECTION' })
})

it('still mints a plain token when no item is named', async () => {
  await signedIn()

  const response = await connectTokenPost(
    jsonRequest('https://app.test/api/pluggy/connect-token', {}),
  )

  expect(response.status).toBe(200)
})
```

Import `connections` from `@/lib/db/schema` and `createHousehold` at the top of the file if they are not already there.

404 rather than 403: an item the caller's household does not have is, from that session's point of view, an item that does not exist. Answering 403 would confirm the id is real somewhere.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/api-routes.test.ts`
Expected: FAIL — the route takes no argument and ignores any item.

- [ ] **Step 3: Add the scoped lookup**

In `lib/db/connections.ts`:

```ts
export async function connectionByItemId(
  db: Db,
  householdId: string,
  itemId: string,
): Promise<Connection | null> {
  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.householdId, householdId), eq(connections.pluggyItemId, itemId)))
    .limit(1)
  return row ?? null
}
```

with `and` added to the `drizzle-orm` import.

- [ ] **Step 4: Rewrite the route**

`app/api/pluggy/connect-token/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSessionOrResponse } from '@/lib/auth/guard'
import { getDb } from '@/lib/db/client'
import { connectionByItemId } from '@/lib/db/connections'
import { loadEnv } from '@/lib/env'
import { createPluggyClient } from '@/lib/pluggy/client'

const body = z.object({ itemId: z.string().min(1).optional() })

export async function POST(request: Request) {
  const guard = await requireSessionOrResponse()
  if (guard.response) return guard.response
  const session = guard.session

  // The button posts an empty body when connecting a new bank, and some
  // callers post nothing at all; neither is an error.
  const parsed = body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  const itemId = parsed.data.itemId

  // An update-mode token reopens an existing bank connection. The item id
  // arrives from the client, so it is proof of nothing: without this check a
  // signed-in user could name any item id and be handed a token for it.
  if (itemId && !(await connectionByItemId(getDb(), session.householdId, itemId))) {
    return NextResponse.json({ error: 'UNKNOWN_CONNECTION' }, { status: 404 })
  }

  const env = loadEnv()
  const pluggy = createPluggyClient({
    apiUrl: env.PLUGGY_API_URL,
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
  })

  return NextResponse.json({ accessToken: await pluggy.createConnectToken(itemId) })
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: mint an update-mode connect token, scoped to the household"
```

---

### Task 7: The connections screen

The banner names a broken institution and offers nowhere to go. This is the somewhere.

**Files:**
- Create: `app/(app)/settings/connections/page.tsx`, `state.ts`, `ConnectionForms.tsx`
- Create: `components/ConnectBankButton.tsx`
- Delete: `components/ConnectCardButton.tsx`
- Modify: `lib/db/connections.ts`, `app/(app)/layout.tsx`, `app/(app)/ledger/page.tsx`, `components/StaleBanner.tsx`, `app/globals.css`
- Create: `tests/connections-page.test.ts`

**Interfaces:**
- Consumes: `listConnections`, `listAccounts`, `listHouseholdUsers`, `staleReason`.
- Produces:
  - `listConnectionDetails(db: Db, householdId: string, opts?: { now?: Date }): Promise<ConnectionDetail[]>` from `lib/db/connections.ts`, where
    `ConnectionDetail = { id: string; institution: string; ownerName: string; status: ConnectionStatus; lastSyncedAt: Date | null; pluggyItemId: string; stale: StaleReason | null; accounts: { id: string; type: 'CREDIT' | 'BANK'; name: string; last4: string | null; dueDay: number | null }[] }`
  - `<ConnectBankButton itemId?: string label?: string />` from `components/ConnectBankButton.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/connections-page.test.ts`. It exercises the read model rather than rendering React — the project has no DOM renderer, and `tests/settings-forms.test.ts` is the precedent for asserting the data a screen is built from:

```ts
import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listConnectionDetails } from '@/lib/db/connections'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

const NOW = new Date('2026-08-23T12:00:00Z')

it('reports each connection with its owner, staleness and accounts', async () => {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: 'item-nubank-1',
      institution: 'Nubank',
      status: 'LOGIN_ERROR',
      lastSyncedAt: NOW,
    })
    .returning({ id: connections.id })
  await seedAccount(db, connection.id, { name: 'Cartao', type: 'CREDIT' })
  await seedAccount(db, connection.id, { name: 'Conta', type: 'BANK' })

  const [detail] = await listConnectionDetails(db, householdId, { now: NOW })

  expect(detail.institution).toBe('Nubank')
  expect(detail.ownerName).toBe('Inacio')
  // A LOGIN_ERROR is stale however recently it synced -- that is the whole
  // point of the reason, and the screen has to offer the repair.
  expect(detail.stale).toBe('NEEDS_REAUTH')
  expect(detail.accounts.map((a) => a.name).sort()).toEqual(['Cartao', 'Conta'])
})

it('shows nothing from another household', async () => {
  const db = testDb()
  const mine = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const theirs = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })
  await db.insert(connections).values({
    householdId: theirs.householdId,
    ownerUserId: theirs.userId,
    pluggyItemId: 'item-theirs-1',
    institution: 'Itau',
    status: 'UPDATED',
    lastSyncedAt: NOW,
  })

  expect(await listConnectionDetails(db, mine.householdId, { now: NOW })).toEqual([])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/connections-page.test.ts`
Expected: FAIL — `listConnectionDetails` is not exported.

- [ ] **Step 3: Write the read model**

In `lib/db/connections.ts`:

```ts
export type ConnectionAccount = {
  id: string
  type: 'CREDIT' | 'BANK'
  name: string
  last4: string | null
  dueDay: number | null
}

export type ConnectionDetail = {
  id: string
  institution: string
  ownerName: string
  status: Connection['status']
  lastSyncedAt: Date | null
  pluggyItemId: string
  stale: StaleReason | null
  accounts: ConnectionAccount[]
}

/**
 * Everything the connections screen shows, in one household-scoped read.
 *
 * `stale` is resolved here rather than on the page so the screen and the
 * banner cannot disagree about which connection is broken.
 */
export async function listConnectionDetails(
  db: Db,
  householdId: string,
  opts: { now?: Date } = {},
): Promise<ConnectionDetail[]> {
  const now = opts.now ?? new Date()
  const [rows, members] = await Promise.all([
    listConnections(db, householdId),
    listHouseholdUsers(db, householdId),
  ])
  const nameByUserId = new Map(members.map((m) => [m.id, m.name]))
  const all = await listAccounts(db, householdId)

  return rows.map((connection) => ({
    id: connection.id,
    institution: connection.institution,
    ownerName: nameByUserId.get(connection.ownerUserId) ?? 'Unknown',
    status: connection.status,
    lastSyncedAt: connection.lastSyncedAt,
    pluggyItemId: connection.pluggyItemId,
    stale: staleReason(connection, now),
    accounts: all
      .filter((account) => account.connectionId === connection.id)
      .map((account) => ({
        id: account.id,
        type: account.type,
        name: account.name,
        last4: account.last4,
        dueDay: account.dueDay,
      })),
  }))
}
```

Import `listHouseholdUsers` from `./households` and `staleReason`, `type StaleReason` from `@/lib/domain/health`. Check `listHouseholdUsers`' returned shape and use its actual id/name fields.

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/connections-page.test.ts`
Expected: PASS.

- [ ] **Step 5: Generalize the connect button**

Create `components/ConnectBankButton.tsx` from `ConnectCardButton`, adding update mode:

```tsx
'use client'

import { useState } from 'react'

declare global {
  interface Window {
    PluggyConnect?: new (options: {
      connectToken: string
      onSuccess: (data: { item: { id: string } }) => void
    }) => { init: () => void }
  }
}

/**
 * Connects a new bank, or -- given an itemId -- reopens Pluggy Connect
 * against an existing one to repair a broken consent. Both paths end in the
 * same POST /api/connections, which re-runs attachConnection and syncs.
 */
export function ConnectBankButton({ itemId, label }: { itemId?: string; label?: string } = {}) {
  const [busy, setBusy] = useState(false)

  async function connect() {
    setBusy(true)
    try {
      const response = await fetch('/api/pluggy/connect-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(itemId ? { itemId } : {}),
      })
      const { accessToken } = (await response.json()) as { accessToken: string }

      if (!window.PluggyConnect) throw new Error('Pluggy Connect script not loaded')

      new window.PluggyConnect({
        connectToken: accessToken,
        onSuccess: async ({ item }) => {
          await fetch('/api/connections', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ itemId: item.id }),
          })
          window.location.reload()
        },
      }).init()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={connect} disabled={busy}>
      {busy ? 'Opening…' : (label ?? 'Connect a bank')}
    </button>
  )
}
```

```bash
git rm components/ConnectCardButton.tsx
```

- [ ] **Step 6: Write the screen**

Create `app/(app)/settings/connections/state.ts`:

```ts
export type ConnectionState = { error: string | null; message: string | null }

export const REMOVED_MESSAGE = 'Connection removed.'
export const UNKNOWN_CONNECTION_ERROR = 'That connection no longer exists.'
```

Create `app/(app)/settings/connections/page.tsx`:

```tsx
import { ConnectBankButton } from '@/components/ConnectBankButton'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { listConnectionDetails } from '@/lib/db/connections'

export const dynamic = 'force-dynamic'

function syncedLabel(at: Date | null): string {
  if (!at) return 'never synced'
  return `synced ${at.toISOString().slice(0, 16).replace('T', ' ')}`
}

export default async function ConnectionsSettingsPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const details = await listConnectionDetails(getDb(), session.householdId)

  return (
    <main className="page page--narrow">
      <header className="page__header">
        <h1>Connections</h1>
        <ConnectBankButton />
      </header>

      {details.length === 0 ? (
        <p className="empty">No banks connected yet.</p>
      ) : (
        <ul className="settings__list">
          {details.map((connection) => (
            <li key={connection.id} className="settings__row settings__row--stacked">
              <div>
                <strong>{connection.institution}</strong> · {connection.ownerName}
                <p className="settings__meta">
                  {connection.status.toLowerCase().replace('_', ' ')} ·{' '}
                  {syncedLabel(connection.lastSyncedAt)}
                </p>
                {connection.stale ? (
                  <p role="alert" className="form__error">
                    {connection.stale === 'NEEDS_REAUTH'
                      ? 'This bank needs reconnecting before its figures can be trusted.'
                      : 'This bank has not updated recently.'}
                  </p>
                ) : null}
                <ul className="settings__sublist">
                  {connection.accounts.map((account) => (
                    <li key={account.id}>
                      {account.name} {account.last4 ? `••${account.last4}` : null} ·{' '}
                      {account.type === 'CREDIT' ? 'card' : 'checking'}
                      {account.dueDay ? ` · due on the ${account.dueDay}` : null}
                    </li>
                  ))}
                </ul>
              </div>
              <ConnectBankButton itemId={connection.pluggyItemId} label="Reconnect" />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] **Step 7: Point the app at it**

`app/(app)/layout.tsx` — add before the Categories link:

```tsx
          <li>
            <Link href="/settings/connections">Connections</Link>
          </li>
```

`components/StaleBanner.tsx` — make each institution a link, so the banner leads to the repair:

```tsx
import Link from 'next/link'
import type { HouseholdHealth } from '@/lib/db/health'

export function StaleBanner({ health }: { health: HouseholdHealth }) {
  if (health.allFresh) return null

  return (
    <aside role="alert" className="banner banner--stale">
      <strong>Some data may be missing.</strong>
      <ul>
        {health.stale.map((s) => (
          <li key={s.connectionId}>
            <Link href="/settings/connections">{s.institution}</Link>{' '}
            {s.reason === 'NEEDS_REAUTH' ? 'needs reconnecting' : 'has not updated recently'}
          </li>
        ))}
      </ul>
    </aside>
  )
}
```

`app/(app)/ledger/page.tsx` — drop the `ConnectCardButton` import and its usage, and put a link in its place:

```tsx
        <Link href="/settings/connections">Connections</Link>
```

`app/globals.css` — add beside the existing `.settings__row` rules:

```css
.settings__row--stacked {
  align-items: flex-start;
}

.settings__meta {
  margin: 0.25rem 0;
  font-size: 0.875rem;
  opacity: 0.7;
}

.settings__sublist {
  margin: 0.25rem 0 0;
  padding-left: 1rem;
  font-size: 0.875rem;
}
```

- [ ] **Step 8: Run the suite and the type check**

Run: `pnpm test`
Expected: PASS. `tests/ledger-view.test.ts` may reference the removed button — update it if so.

Run: `pnpm build`
Expected: compiles. This is the step that catches a missed `ConnectCardButton` import.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add the connections screen, and let the banner lead to it"
```

---

### Task 8: Remove a connection

The one irreversible action in the slice. The FK cascade runs `connection → account → transaction`, so the confirmation has to say what that costs.

**Files:**
- Modify: `lib/db/connections.ts`, `app/(app)/settings/connections/page.tsx`
- Create: `app/(app)/settings/connections/actions.ts`, `app/(app)/settings/connections/ConnectionForms.tsx`
- Create: `tests/connection-actions.test.ts`

**Interfaces:**
- Consumes: `ConnectionState` from `./state`.
- Produces:
  - `countConnectionTransactions(db: Db, householdId: string, connectionId: string): Promise<number>` from `lib/db/connections.ts`
  - `deleteConnection(db: Db, householdId: string, connectionId: string): Promise<{ removed: boolean }>` from `lib/db/connections.ts`
  - `removeConnectionAction(prev: ConnectionState, formData: FormData): Promise<ConnectionState>` from `app/(app)/settings/connections/actions.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/connection-actions.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

const session = vi.hoisted(() => ({ current: { householdId: '', id: '' } }))
vi.mock('@/lib/auth/session', () => ({
  requireSession: async () => session.current,
  toSignInOrThrow: () => {
    throw new Error('UNAUTHENTICATED')
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { removeConnectionAction } = await import('@/app/(app)/settings/connections/actions')
const { UNKNOWN_CONNECTION_ERROR } = await import('@/app/(app)/settings/connections/state')

const EMPTY = { error: null, message: null }

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

async function seedConnection(institution: string, householdId: string, userId: string) {
  const db = testDb()
  const [row] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution,
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, row.id)
  await insertTransaction(db, accountId, { description: `${institution} ZAFFARI` })
  return row.id
}

it('removes one connection and leaves the other household connection intact', async () => {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  session.current = { householdId, id: userId }
  const doomed = await seedConnection('Nubank', householdId, userId)
  await seedConnection('Itau', householdId, userId)

  const state = await removeConnectionAction(EMPTY, form({ connectionId: doomed }))

  expect(state.error).toBeNull()
  const rows = await listTransactions(db, householdId, { includeExcluded: true })
  expect(rows).toHaveLength(1)
  expect(rows[0].institution).toBe('Itau')
})

it('refuses to remove another household connection', async () => {
  const db = testDb()
  const mine = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const theirs = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })
  session.current = { householdId: mine.householdId, id: mine.userId }
  const target = await seedConnection('Itau', theirs.householdId, theirs.userId)

  const state = await removeConnectionAction(EMPTY, form({ connectionId: target }))

  expect(state.error).toBe(UNKNOWN_CONNECTION_ERROR)
  const survivors = await listTransactions(db, theirs.householdId, { includeExcluded: true })
  expect(survivors).toHaveLength(1)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/connection-actions.test.ts`
Expected: FAIL — no actions module.

- [ ] **Step 3: Write the scoped queries**

In `lib/db/connections.ts`:

```ts
/** How much history removing this connection would destroy. */
export async function countConnectionTransactions(
  db: Db,
  householdId: string,
  connectionId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(and(eq(connections.householdId, householdId), eq(connections.id, connectionId)))
  return Number(row?.count ?? 0)
}

/**
 * Removes a connection and, by FK cascade, its accounts and every
 * transaction in them. Scoped to the household in the DELETE itself, so a
 * connection id from elsewhere deletes nothing rather than deleting
 * someone else's history.
 */
export async function deleteConnection(
  db: Db,
  householdId: string,
  connectionId: string,
): Promise<{ removed: boolean }> {
  const rows = await db
    .delete(connections)
    .where(and(eq(connections.householdId, householdId), eq(connections.id, connectionId)))
    .returning({ id: connections.id })
  return { removed: rows.length > 0 }
}
```

Add `sql` and `transactions` to the imports.

- [ ] **Step 4: Write the action**

Create `app/(app)/settings/connections/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { deleteConnection } from '@/lib/db/connections'
import { type ConnectionState, REMOVED_MESSAGE, UNKNOWN_CONNECTION_ERROR } from './state'

export async function removeConnectionAction(
  _prev: ConnectionState,
  formData: FormData,
): Promise<ConnectionState> {
  const session = await requireSession()
  const connectionId = String(formData.get('connectionId') ?? '')
  if (!connectionId) return { error: UNKNOWN_CONNECTION_ERROR, message: null }

  // A connection id belonging to another household deletes nothing, and is
  // reported as gone rather than as forbidden -- from this session's point of
  // view it does not exist.
  const { removed } = await deleteConnection(getDb(), session.householdId, connectionId)
  if (!removed) return { error: UNKNOWN_CONNECTION_ERROR, message: null }

  revalidatePath('/settings/connections')
  revalidatePath('/dashboard')
  revalidatePath('/ledger')
  return { error: null, message: REMOVED_MESSAGE }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/connection-actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Put the confirmation on the screen**

Create `app/(app)/settings/connections/ConnectionForms.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { removeConnectionAction } from './actions'
import type { ConnectionState } from './state'

const INITIAL: ConnectionState = { error: null, message: null }

/**
 * Two steps, not a confirm() dialog: removing a connection cascades to every
 * transaction it ever carried, and the count is the part worth reading before
 * clicking. Step one is a link that sets ?remove=<id>; this is step two.
 */
export function RemoveConnectionForm({
  connectionId,
  institution,
  transactionCount,
}: {
  connectionId: string
  institution: string
  transactionCount: number
}) {
  const [state, formAction, pending] = useActionState(removeConnectionAction, INITIAL)

  return (
    <form action={formAction} className="settings__confirm">
      <input type="hidden" name="connectionId" value={connectionId} />
      <p>
        Remove <strong>{institution}</strong> and delete {transactionCount} transactions? This
        cannot be undone.
      </p>
      {state.error ? (
        <p role="alert" className="form__error">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Removing…' : `Yes, delete ${transactionCount} transactions`}
      </button>
    </form>
  )
}
```

In `page.tsx`, read the search param, count the history, and render either the link or the confirmation:

```tsx
export default async function ConnectionsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ remove?: string }>
}) {
  const session = await requireSession().catch(toSignInOrThrow)
  const { remove } = await searchParams
  const db = getDb()
  const details = await listConnectionDetails(db, session.householdId)
  const removing = remove
    ? { id: remove, count: await countConnectionTransactions(db, session.householdId, remove) }
    : null
```

and inside the list item, after the Reconnect button:

```tsx
              {removing?.id === connection.id ? (
                <RemoveConnectionForm
                  connectionId={connection.id}
                  institution={connection.institution}
                  transactionCount={removing.count}
                />
              ) : (
                <Link href={`/settings/connections?remove=${connection.id}`}>Remove</Link>
              )}
```

with `Link`, `RemoveConnectionForm` and `countConnectionTransactions` imported.

- [ ] **Step 7: Run the suite and build**

Run: `pnpm test && pnpm build`
Expected: PASS and compiles.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: remove a connection, behind a confirmation that names the cost"
```

---

### Task 9: Due and closing day overrides

Connectors are inconsistent about reporting `balanceDueDate`, and an editable Pluggy-written column would be clobbered by the next sync. An override column cannot be.

**Files:**
- Modify: `lib/db/schema.ts`, `lib/db/connections.ts`
- Create: `drizzle/0010_day_overrides.sql` (generated)
- Modify: `app/(app)/settings/connections/actions.ts`, `ConnectionForms.tsx`, `page.tsx`, `state.ts`
- Modify: `tests/connection-actions.test.ts`

**Interfaces:**
- Consumes: `ConnectionState`, `listConnectionDetails`.
- Produces:
  - `accounts.dueDayOverride`, `accounts.closingDayOverride` columns
  - `setAccountDays(db: Db, householdId: string, accountId: string, days: { dueDay: number | null; closingDay: number | null }): Promise<{ updated: boolean }>` from `lib/db/connections.ts`
  - `saveAccountDaysAction(prev: ConnectionState, formData: FormData): Promise<ConnectionState>` from the connections actions
  - `ConnectionAccount` gains `closingDay: number | null` and both resolved days come from `coalesce(override, pluggy)`

- [ ] **Step 1: Write the failing tests**

Add to `tests/connection-actions.test.ts`:

```ts
it('keeps an overridden due day across a sync that rewrites the Pluggy value', async () => {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  session.current = { householdId, id: userId }
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: 'item-nubank-1',
      institution: 'Nubank',
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, connection.id)
  await db.update(accounts).set({ dueDay: 10 }).where(eq(accounts.id, accountId))

  const state = await saveAccountDaysAction(EMPTY, form({ accountId, dueDay: '15', closingDay: '3' }))
  expect(state.error).toBeNull()

  // What a sync does: rewrite the Pluggy-sourced column. The override must
  // survive it, which is the entire reason it is a separate column.
  await db.update(accounts).set({ dueDay: 10 }).where(eq(accounts.id, accountId))

  const [detail] = await listConnectionDetails(db, householdId)
  expect(detail.accounts[0].dueDay).toBe(15)
  expect(detail.accounts[0].closingDay).toBe(3)
})

it('rejects a day outside the month', async () => {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  session.current = { householdId, id: userId }
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: 'item-nubank-2',
      institution: 'Nubank',
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, connection.id)

  const state = await saveAccountDaysAction(EMPTY, form({ accountId, dueDay: '32', closingDay: '' }))

  expect(state.error).toBe(INVALID_DAY_ERROR)
})

it('refuses to set days on another household account', async () => {
  const db = testDb()
  const mine = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const theirs = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })
  session.current = { householdId: mine.householdId, id: mine.userId }
  const [connection] = await db
    .insert(connections)
    .values({
      householdId: theirs.householdId,
      ownerUserId: theirs.userId,
      pluggyItemId: 'item-theirs-2',
      institution: 'Itau',
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, connection.id)

  const state = await saveAccountDaysAction(EMPTY, form({ accountId, dueDay: '15', closingDay: '' }))

  expect(state.error).toBe(UNKNOWN_ACCOUNT_ERROR)
})
```

Add `accounts` and `eq` to that file's imports, and pull `saveAccountDaysAction`, `INVALID_DAY_ERROR`, `UNKNOWN_ACCOUNT_ERROR` and `listConnectionDetails` into the existing import block.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/connection-actions.test.ts`
Expected: FAIL — no `saveAccountDaysAction`.

- [ ] **Step 3: Add the columns**

In `lib/db/schema.ts`, in the `accounts` table:

```ts
    // Pluggy's value stays in due_day / closing_day and is rewritten freely by
    // every sync. A household override lives here, so an edit can never be
    // clobbered and the sync path needs no knowledge that overrides exist.
    dueDayOverride: integer('due_day_override'),
    closingDayOverride: integer('closing_day_override'),
```

Run: `pnpm db:generate`

Rename the generated file to `drizzle/0010_day_overrides.sql`, updating `drizzle/meta/_journal.json` to match. Two nullable columns need no backfill, so the generated SQL is correct as written — read it and confirm it contains only the two `ADD COLUMN` statements.

- [ ] **Step 4: Resolve the override on read**

In `lib/db/connections.ts`, extend `ConnectionAccount` and the mapping in `listConnectionDetails`:

```ts
export type ConnectionAccount = {
  id: string
  type: 'CREDIT' | 'BANK'
  name: string
  last4: string | null
  dueDay: number | null
  closingDay: number | null
  overridden: boolean
}
```

```ts
      .map((account) => ({
        id: account.id,
        type: account.type,
        name: account.name,
        last4: account.last4,
        dueDay: account.dueDayOverride ?? account.dueDay,
        closingDay: account.closingDayOverride ?? account.closingDay,
        overridden: account.dueDayOverride != null || account.closingDayOverride != null,
      })),
```

And the scoped write:

```ts
/**
 * Sets the household's own due and closing day for one account. Null clears
 * the override and falls back to whatever Pluggy reports.
 */
export async function setAccountDays(
  db: Db,
  householdId: string,
  accountId: string,
  days: { dueDay: number | null; closingDay: number | null },
): Promise<{ updated: boolean }> {
  const rows = await db
    .update(accounts)
    .set({ dueDayOverride: days.dueDay, closingDayOverride: days.closingDay })
    .where(
      and(
        eq(accounts.id, accountId),
        // Scoped in the UPDATE itself: an account id from another household
        // must update nothing, not merely be checked first.
        inArray(
          accounts.connectionId,
          db.select({ id: connections.id }).from(connections).where(eq(connections.householdId, householdId)),
        ),
      ),
    )
    .returning({ id: accounts.id })
  return { updated: rows.length > 0 }
}
```

with `inArray` added to the imports.

- [ ] **Step 5: Write the action**

In `state.ts`:

```ts
export const INVALID_DAY_ERROR = 'A day has to be between 1 and 31.'
export const UNKNOWN_ACCOUNT_ERROR = 'That account no longer exists.'
```

In `actions.ts`:

```ts
function parseDay(raw: FormDataEntryValue | null): number | null | 'INVALID' {
  const value = String(raw ?? '').trim()
  if (!value) return null
  const day = Number(value)
  // 31 is allowed even in a 30-day month: it means "the last day it can be",
  // and this is invoice context, not a date the system computes with.
  if (!Number.isInteger(day) || day < 1 || day > 31) return 'INVALID'
  return day
}

export async function saveAccountDaysAction(
  _prev: ConnectionState,
  formData: FormData,
): Promise<ConnectionState> {
  const session = await requireSession()
  const accountId = String(formData.get('accountId') ?? '')
  if (!accountId) return { error: UNKNOWN_ACCOUNT_ERROR, message: null }

  const dueDay = parseDay(formData.get('dueDay'))
  const closingDay = parseDay(formData.get('closingDay'))
  if (dueDay === 'INVALID' || closingDay === 'INVALID') {
    return { error: INVALID_DAY_ERROR, message: null }
  }

  const { updated } = await setAccountDays(getDb(), session.householdId, accountId, {
    dueDay,
    closingDay,
  })
  if (!updated) return { error: UNKNOWN_ACCOUNT_ERROR, message: null }

  revalidatePath('/settings/connections')
  return { error: null, message: SAVED_MESSAGE }
}
```

Import `setAccountDays`, `INVALID_DAY_ERROR`, `UNKNOWN_ACCOUNT_ERROR`, and `SAVED_MESSAGE` from `../categories/state` — reuse it rather than declaring a second copy of the same word.

- [ ] **Step 6: Put the form on the screen**

In `ConnectionForms.tsx`:

```tsx
export function AccountDaysForm({
  accountId,
  dueDay,
  closingDay,
}: {
  accountId: string
  dueDay: number | null
  closingDay: number | null
}) {
  const [state, formAction, pending] = useActionState(saveAccountDaysAction, INITIAL)

  return (
    <form action={formAction} className="settings__inline">
      <input type="hidden" name="accountId" value={accountId} />
      <label>
        Due day
        <input name="dueDay" type="number" min={1} max={31} defaultValue={dueDay ?? ''} />
      </label>
      <label>
        Closing day
        <input name="closingDay" type="number" min={1} max={31} defaultValue={closingDay ?? ''} />
      </label>
      {state.error ? (
        <p role="alert" className="form__error">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="form__message">{state.message}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
```

In `page.tsx`, render it only for credit accounts — a checking account has no invoice:

```tsx
                    <li key={account.id}>
                      {account.name} {account.last4 ? `••${account.last4}` : null} ·{' '}
                      {account.type === 'CREDIT' ? 'card' : 'checking'}
                      {account.type === 'CREDIT' ? (
                        <AccountDaysForm
                          accountId={account.id}
                          dueDay={account.dueDay}
                          closingDay={account.closingDay}
                        />
                      ) : null}
                    </li>
```

Add to `app/globals.css`:

```css
.settings__inline {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: flex-end;
  margin-top: 0.25rem;
}
```

- [ ] **Step 7: Run everything**

Run: `pnpm test && pnpm build`
Expected: PASS and compiles.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: let the household override a card due and closing day"
```

---

## Done when

- `pnpm test` is green and `pnpm build` compiles.
- A checking account can be connected and its invoice payments and salary are absent from every budget figure, while its ordinary spending is present.
- `/settings/connections` lists every connection with its owner, status and accounts; connects a new bank; reconnects a broken one; removes one behind a confirmation; and edits a card's due day.
- The stale banner links to that screen.
- `lib/domain/budget-role.ts` records what Task 1 observed, and no `is_transfer` remains in the codebase.
