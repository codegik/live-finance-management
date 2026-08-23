import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { setBudget } from '@/lib/db/budgets'
import { archiveCategory, listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { recategorize } from '@/lib/sync/categorize'
import { refreshBudgetRoles } from '@/lib/sync/budget-roles'
import { getDashboardView } from '@/lib/views/dashboard'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

/** The 10th of August, so 10 days elapsed of 31. */
const NOW = new Date('2026-08-10T15:00:00.000Z')

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
      lastSyncedAt: NOW,
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, connection.id)
  return { db, householdId, accountId }
}

async function categoryNamed(householdId: string, name: string): Promise<string> {
  const all = await listCategories(testDb(), householdId)
  return all.find((c) => c.name === name)!.id
}

it('reports spend, budget and pace for the current month', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  await setBudget(db, householdId, { categoryId: supermarket, period: '2026-08', amountCents: 120_000 })
  // insertTransaction is a raw seed and deliberately leaves category_id
  // unset, exactly as it leaves budget_role at its default -- recategorize()
  // is the only code that resolves a Pluggy category into a household's
  // category id (lib/sync/categorize.ts), and in production the ingest
  // pipeline runs it on every synced row.
  await recategorize(db, { householdId })

  const view = await getDashboardView(db, householdId, { now: NOW })

  expect(view.period).toBe('2026-08')
  const row = view.rows.find((r) => r.categoryId === supermarket)!
  expect(row).toMatchObject({
    categoryName: 'Supermercado',
    spentCents: 30_000,
    variableCents: 30_000,
    committedCents: 0,
    budgetCents: 120_000,
  })
  // 30_000 over 10 of 31 days.
  expect(row.paceCents).toBe(93_000)
})

it('adds an instalment at face value instead of extrapolating it', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const car = await categoryNamed(householdId, 'Manutenção de carro')
  await insertTransaction(db, accountId, {
    description: 'AUTO MECANICA BOA 05/10',
    amountCents: 114_709,
    date: '2026-08-17',
    pluggyCategory: 'Vehicle maintenance',
  })
  // See the note in the previous test -- insertTransaction leaves category_id
  // unset, so this row needs the same resolution pass the ingest pipeline
  // runs in production.
  await recategorize(db, { householdId })

  const view = await getDashboardView(db, householdId, { now: NOW })

  const row = view.rows.find((r) => r.categoryId === car)!
  // Dated the 17th, so it has not landed yet on the 10th -- but it is
  // committed either way, and must not become a daily rate.
  expect(row.variableCents).toBe(0)
  expect(row.committedCents).toBe(114_709)
  expect(row.paceCents).toBe(114_709)
})

// Parent spec case 2.
it('leaves invoice payments out of every figure', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  await insertTransaction(db, accountId, {
    description: 'PAGAMENTO FATURA',
    amountCents: -177_174_79,
    date: '2026-08-06',
    pluggyCategory: 'Credit card payment',
  })
  await refreshBudgetRoles(db, householdId)

  const view = await getDashboardView(db, householdId, { now: NOW })

  expect(view.totalSpentCents).toBe(30_000)
  expect(view.rows.every((r) => r.spentCents >= 0)).toBe(true)
})

it('counts only the month asked about', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 10_000,
    date: '2026-07-31',
    pluggyCategory: 'Groceries',
  })
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 20_000,
    date: '2026-08-01',
    pluggyCategory: 'Groceries',
  })
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 40_000,
    date: '2026-09-01',
    pluggyCategory: 'Groceries',
  })

  const view = await getDashboardView(db, householdId, { now: NOW })

  expect(view.totalSpentCents).toBe(20_000)
})

it('carries a budget forward from an earlier month', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await setBudget(db, householdId, { categoryId: supermarket, period: '2026-05', amountCents: 90_000 })
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 10_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })

  const view = await getDashboardView(db, householdId, { now: NOW })

  expect(view.rows.find((r) => r.categoryId === supermarket)!.budgetCents).toBe(90_000)
})

it('shows a category with no budget as having none, not as zero', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 10_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  await recategorize(db, { householdId })

  const view = await getDashboardView(db, householdId, { now: NOW })

  // find(), not rows[0]: which category sorts first is a display decision
  // (category.sortOrder), and this assertion is not about that.
  expect(view.rows.find((r) => r.categoryId === supermarket)!.budgetCents).toBeNull()
  expect(view.totalBudgetCents).toBe(0)
})

it('reports uncategorized spend separately rather than hiding it', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, {
    description: 'ALGO DESCONHECIDO',
    amountCents: 5_000,
    date: '2026-08-05',
  })

  const view = await getDashboardView(db, householdId, { now: NOW })

  expect(view.uncategorizedSpentCents).toBe(5_000)
  expect(view.uncategorizedCount).toBe(1)
  // It is real money, so it belongs in the total.
  expect(view.totalSpentCents).toBe(5_000)
  expect(view.rows.every((r) => r.categoryId !== null)).toBe(true)
})

it('carries connection health so the dashboard can never read as on track while stale', async () => {
  const { db, householdId } = await seedHousehold()

  const view = await getDashboardView(db, householdId, { now: NOW })

  expect(view.health.allFresh).toBe(true)
})

it('never counts another household', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 10_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  const { householdId: otherId } = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })

  const view = await getDashboardView(db, otherId, { now: NOW })

  // The other household has its own seeded taxonomy, so it has rows -- they
  // must simply all be empty.
  expect(view.totalSpentCents).toBe(0)
  expect(view.rows.every((r) => r.spentCents === 0)).toBe(true)
})

// Whole-branch defect: the household total was summed from `rows`, which
// comes from listCategories and therefore excludes archived categories --
// while the transactions pointing at an archived category are reassigned to
// nothing. The money stayed on /ledger and vanished from the dashboard.
it('keeps the spend of an archived category in the household total', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  await recategorize(db, { householdId })

  const before = await getDashboardView(db, householdId, { now: NOW })
  // The premise, asserted rather than assumed: the spend really is attached
  // to the category about to be archived. Without this, archiving a category
  // with nothing on it would "prove" the fix while proving nothing.
  expect(before.rows.find((r) => r.categoryId === supermarket)!.spentCents).toBe(30_000)
  expect(before.totalSpentCents).toBe(30_000)

  await archiveCategory(db, householdId, supermarket)

  const after = await getDashboardView(db, householdId, { now: NOW })

  // Archived, so it is not drawn...
  expect(after.rows.some((r) => r.categoryId === supermarket)).toBe(false)
  // ...and archiving reassigned nothing, so the row is not uncategorized
  // either -- it is in neither of the two buckets the old total added up.
  expect(after.uncategorizedSpentCents).toBe(0)
  expect(after.uncategorizedCount).toBe(0)
  // The money is real, is not a transfer, and /ledger still shows it.
  expect(after.totalSpentCents).toBe(30_000)
})

it('counts the uncategorized rows of this month only, not of all time', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, {
    description: 'ALGO DESCONHECIDO',
    amountCents: 5_000,
    date: '2026-08-05',
  })
  // Three older uncategorized rows: real work for the inbox, but not part of
  // the amount rendered beside the count on the dashboard badge.
  for (const date of ['2026-05-02', '2026-06-11', '2026-07-30']) {
    await insertTransaction(db, accountId, {
      description: 'OUTRO DESCONHECIDO',
      amountCents: 90_000,
      date,
    })
  }

  const view = await getDashboardView(db, householdId, { now: NOW })

  expect(view.uncategorizedCount).toBe(1)
  expect(view.uncategorizedSpentCents).toBe(5_000)
})
