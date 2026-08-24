import { and, eq } from 'drizzle-orm'
import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listBudgets, setBudget } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { accounts, connections, transactions } from '@/lib/db/schema'
import { assertLocalDatabase, clearDemoData, DEMO_ITEM_ID, seedDemoData } from '@/lib/demo/seed'
import { getMonthView } from '@/lib/views/month'
import { getYearView } from '@/lib/views/year'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

const NOW = new Date('2026-08-23T15:00:00.000Z')
const PERIOD = '2026-08'

async function seedHousehold() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  return { db, householdId, userId }
}

/** A connection standing in for one a real bank actually synced. */
async function seedRealConnection(db: ReturnType<typeof testDb>, householdId: string, userId: string) {
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: 'real-item',
      institution: 'Nubank',
      status: 'UPDATED',
      lastSyncedAt: NOW,
    })
    .returning({ id: connections.id })
  return seedAccount(db, connection.id)
}

async function countDemoTransactions(db: ReturnType<typeof testDb>): Promise<number> {
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(eq(connections.pluggyItemId, DEMO_ITEM_ID))
  return rows.length
}

// --- The guard. It is the only thing between this and a real household's
// --- database, so it is tested before anything it protects.

it('refuses any database that is not local', () => {
  expect(() => assertLocalDatabase('postgres://u:p@db.railway.app:5432/finance')).toThrow(
    /DEMO_REFUSED/,
  )
  expect(() => assertLocalDatabase('postgres://u:p@10.0.0.4:5432/finance')).toThrow(/DEMO_REFUSED/)
})

it('refuses production even when the database is local', () => {
  // A local database is not the same claim as a local deployment, and this
  // writes invented salaries either way.
  expect(() => assertLocalDatabase('postgres://u:p@localhost:5432/finance', 'production')).toThrow(
    /DEMO_REFUSED/,
  )
})

it('fails closed on a URL it cannot parse rather than assuming it is safe', () => {
  expect(() => assertLocalDatabase('not a url at all')).toThrow(/DEMO_REFUSED/)
})

it('allows localhost and the loopback addresses', () => {
  expect(() => assertLocalDatabase('postgres://u:p@localhost:5432/finance')).not.toThrow()
  expect(() => assertLocalDatabase('postgres://u:p@127.0.0.1:5432/finance')).not.toThrow()
})

// --- Idempotence. Re-running must leave ONE demo household, not two: this
// --- runs on every ./start.sh, so "runs twice" is the normal case, not an
// --- edge one. Doubling the figures would be invisible -- every screen would
// --- still render, just with a household earning a hundred thousand a month.

it('writes exactly one dataset however many times it runs', async () => {
  const { db, householdId } = await seedHousehold()

  const first = await seedDemoData(db, householdId, { now: NOW })
  const afterFirst = await getMonthView(db, householdId, PERIOD, { now: NOW })
  const countAfterFirst = await countDemoTransactions(db)

  const second = await seedDemoData(db, householdId, { now: NOW })
  const third = await seedDemoData(db, householdId, { now: NOW })
  const afterThird = await getMonthView(db, householdId, PERIOD, { now: NOW })

  expect(second.transactions).toBe(first.transactions)
  expect(third.transactions).toBe(first.transactions)
  expect(await countDemoTransactions(db)).toBe(countAfterFirst)

  // Not just the row count -- the figures themselves, which is what anyone
  // would actually notice being wrong.
  expect(afterThird.incomeCents).toBe(afterFirst.incomeCents)
  expect(afterThird.expenseCents).toBe(afterFirst.expenseCents)
  expect(afterThird.investedCents).toBe(afterFirst.investedCents)
  expect(afterThird.netCents).toBe(afterFirst.netCents)
})

it('does not accumulate a second demo bank on re-run', async () => {
  const { db, householdId } = await seedHousehold()

  await seedDemoData(db, householdId, { now: NOW })
  await seedDemoData(db, householdId, { now: NOW })

  const demoConnections = await db
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(eq(connections.householdId, householdId), eq(connections.pluggyItemId, DEMO_ITEM_ID)),
    )
  expect(demoConnections).toHaveLength(1)

  const demoAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.connectionId, demoConnections[0].id))
  expect(demoAccounts).toHaveLength(2)
})

it('does not accumulate plans on re-run', async () => {
  const { db, householdId } = await seedHousehold()

  await seedDemoData(db, householdId, { now: NOW })
  const first = await listBudgets(db, householdId)
  await seedDemoData(db, householdId, { now: NOW })
  const second = await listBudgets(db, householdId)

  expect(second).toHaveLength(first.length)
  expect(second).toEqual(first)
})

it('survives a clear-then-seed cycle unchanged', async () => {
  const { db, householdId } = await seedHousehold()

  await seedDemoData(db, householdId, { now: NOW })
  const before = await getMonthView(db, householdId, PERIOD, { now: NOW })

  await clearDemoData(db, householdId, { now: NOW })
  await seedDemoData(db, householdId, { now: NOW })
  const after = await getMonthView(db, householdId, PERIOD, { now: NOW })

  expect(after.incomeCents).toBe(before.incomeCents)
  expect(after.expenseCents).toBe(before.expenseCents)
})

it('is idempotent when cleared twice', async () => {
  const { db, householdId } = await seedHousehold()
  await seedDemoData(db, householdId, { now: NOW })

  const first = await clearDemoData(db, householdId, { now: NOW })
  const second = await clearDemoData(db, householdId, { now: NOW })

  expect(first.removedTransactions).toBeGreaterThan(0)
  // Nothing left to remove, and no error for having nothing to do.
  expect(second.removedTransactions).toBe(0)
  expect(second.removedPlans).toBe(0)
})

// --- What it writes.

it('gives every screen something to show', async () => {
  const { db, householdId } = await seedHousehold()

  const result = await seedDemoData(db, householdId, { now: NOW })
  expect(result.transactions).toBeGreaterThan(500)

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  // The four blocks the month screen is built from, none of them empty --
  // which is the entire reason this fixture exists.
  for (const group of view.groups) {
    expect(group.rows.length).toBeGreaterThan(0)
    expect(group.plannedCents).toBeGreaterThan(0)
  }
  expect(view.incomeCents).toBeGreaterThan(0)
  expect(view.investedCents).toBeGreaterThan(0)
  expect(view.expenseCents).toBeGreaterThan(0)

  // Work waiting in the inbox, and money committed to a month not yet begun.
  expect(view.uncategorizedCount).toBeGreaterThan(0)
  const future = await getMonthView(db, householdId, '2026-11', { now: NOW })
  expect(future.stance).toBe('FUTURE')
  expect(future.groups.some((g) => g.rows.some((r) => r.committedCents > 0))).toBe(true)
})

it('fills a whole year of the grid, not just the current month', async () => {
  const { db, householdId } = await seedHousehold()
  await seedDemoData(db, householdId, { now: NOW })

  const year = await getYearView(db, householdId, 2026, { now: NOW })

  // January through August. September onward holds instalments only, so it is
  // deliberately not asserted as non-zero.
  for (let month = 0; month < 8; month += 1) {
    expect(year.expenseByMonth[month]).toBeGreaterThan(0)
    expect(year.incomeByMonth[month]).toBeGreaterThan(0)
  }
})

it('points income the right way, so a demo month is not a catastrophe', async () => {
  const { db, householdId } = await seedHousehold()
  await seedDemoData(db, householdId, { now: NOW })

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  // Salary is stored as a credit, so negative centavos. If the flip were
  // wrong the household would open on a Receita of minus fifty thousand and
  // a saldo to match.
  expect(view.incomeCents).toBeGreaterThan(40_000_00)
  expect(view.netCents).toBeGreaterThan(0)
})

it('writes one plan month and lets carry-forward do the rest', async () => {
  const { db, householdId } = await seedHousehold()
  await seedDemoData(db, householdId, { now: NOW })

  const stored = await listBudgets(db, householdId)
  const months = new Set(stored.map((b) => b.periodMonth))

  // One explicit month. Writing twenty-four identical rows would disable the
  // carry-forward it is meant to demonstrate, because a month holding its own
  // row no longer inherits one.
  expect(months.size).toBe(1)

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })
  expect(view.groups.every((g) => g.rows.every((r) => r.plannedCents !== 0))).toBe(true)
})

// --- What it must never touch.

it('removes its own rows and leaves real synced data alone', async () => {
  const { db, householdId, userId } = await seedHousehold()
  const realAccountId = await seedRealConnection(db, householdId, userId)
  await insertTransaction(db, realAccountId, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })

  await seedDemoData(db, householdId, { now: NOW })
  const { removedTransactions } = await clearDemoData(db, householdId, { now: NOW })

  expect(removedTransactions).toBeGreaterThan(500)
  expect(await countDemoTransactions(db)).toBe(0)

  // The real connection and its transaction are exactly as they were.
  const survivors = await db.select({ id: transactions.id }).from(transactions)
  expect(survivors).toHaveLength(1)
  const realConnections = await db
    .select({ id: connections.id })
    .from(connections)
    .where(eq(connections.pluggyItemId, 'real-item'))
  expect(realConnections).toHaveLength(1)
})

it('keeps a plan the household has edited, and removes only the ones it wrote', async () => {
  const { db, householdId } = await seedHousehold()
  await seedDemoData(db, householdId, { now: NOW })

  const stored = await listBudgets(db, householdId)
  const period = stored[0].periodMonth.slice(0, 7)
  const mine = stored[0]

  // The household changes one figure. It is theirs now, whatever wrote it
  // first, and clearing generated data must not take it away.
  await setBudget(db, householdId, {
    categoryId: mine.categoryId,
    period,
    amountCents: 1_234_00,
  })

  const { removedPlans } = await clearDemoData(db, householdId, { now: NOW })

  expect(removedPlans).toBe(stored.length - 1)
  const left = await listBudgets(db, householdId)
  expect(left).toHaveLength(1)
  expect(left[0].amountCents).toBe(1_234_00)
})

it('never invents a category, so the taxonomy is the household own', async () => {
  const { db, householdId } = await seedHousehold()
  const before = await listCategories(db, householdId)

  await seedDemoData(db, householdId, { now: NOW })

  const after = await listCategories(db, householdId)
  expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort())
})
