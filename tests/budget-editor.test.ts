import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { setBudget } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { recategorize } from '@/lib/sync/categorize'
import { getBudgetEditorView } from '@/lib/views/budget-editor'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

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

it('suggests the median of complete months', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  for (const [date, cents] of [
    ['2026-05-10', 10_000],
    ['2026-06-10', 30_000],
    ['2026-07-10', 20_000],
  ] as const) {
    await insertTransaction(db, accountId, {
      description: 'ZAFFARI',
      amountCents: cents,
      date,
      pluggyCategory: 'Groceries',
    })
  }
  // insertTransaction is a raw seed and deliberately leaves category_id
  // unset -- recategorize() is the only code that resolves a Pluggy category
  // into a household's category id (lib/sync/categorize.ts).
  await recategorize(db, { householdId })

  const view = await getBudgetEditorView(db, householdId, '2026-08', { now: NOW })

  const row = view.rows.find((r) => r.categoryId === supermarket)!
  expect(row.suggestionCents).toBe(20_000)
  expect(row.monthsOfHistory).toBe(3)
})

it('ignores the current partial month and any future month', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 20_000,
    date: '2026-07-10',
    pluggyCategory: 'Groceries',
  })
  // A partial current month and a future instalment would both drag the
  // median toward a number the household never actually spent in a month.
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 1_000,
    date: '2026-08-02',
    pluggyCategory: 'Groceries',
  })
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI PARC 02/03',
    amountCents: 1_000,
    date: '2026-11-02',
    pluggyCategory: 'Groceries',
  })
  await recategorize(db, { householdId })

  const view = await getBudgetEditorView(db, householdId, '2026-08', { now: NOW })

  const row = view.rows.find((r) => r.categoryId === supermarket)!
  expect(row.suggestionCents).toBe(20_000)
  expect(row.monthsOfHistory).toBe(1)
})

it('has no suggestion for a category that was never spent in', async () => {
  const { db, householdId } = await seedHousehold()
  const pets = await categoryNamed(householdId, 'Pets')

  const view = await getBudgetEditorView(db, householdId, '2026-08', { now: NOW })

  expect(view.rows.find((r) => r.categoryId === pets)!.suggestionCents).toBeNull()
})

it('shows an amount inherited from an earlier month, and says where from', async () => {
  const { db, householdId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await setBudget(db, householdId, { categoryId: supermarket, period: '2026-05', amountCents: 90_000 })

  const view = await getBudgetEditorView(db, householdId, '2026-08', { now: NOW })

  const row = view.rows.find((r) => r.categoryId === supermarket)!
  expect(row.amountCents).toBe(90_000)
  expect(row.inheritedFrom).toBe('2026-05')
})

it('reports a budget set for this very month as not inherited', async () => {
  const { db, householdId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await setBudget(db, householdId, { categoryId: supermarket, period: '2026-08', amountCents: 90_000 })

  const view = await getBudgetEditorView(db, householdId, '2026-08', { now: NOW })

  const row = view.rows.find((r) => r.categoryId === supermarket)!
  expect(row.amountCents).toBe(90_000)
  expect(row.inheritedFrom).toBeNull()
})

it('lists every live category, budgeted or not', async () => {
  const { db, householdId } = await seedHousehold()

  const view = await getBudgetEditorView(db, householdId, '2026-08', { now: NOW })

  expect(view.rows).toHaveLength((await listCategories(db, householdId)).length)
})
