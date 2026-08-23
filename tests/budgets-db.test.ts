import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { clearBudget, listBudgets, setBudget } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { resetDb, testDb, useTestEnv } from './helpers/db'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

async function seedHousehold(email = 'inacio@example.com') {
  const db = testDb()
  const { householdId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email, name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const [supermarket] = await listCategories(db, householdId)
  return { db, householdId, categoryId: supermarket.id }
}

it('stores a budget against the first of its month', async () => {
  const { db, householdId, categoryId } = await seedHousehold()

  await setBudget(db, householdId, { categoryId, period: '2026-08', amountCents: 120_000 })

  expect(await listBudgets(db, householdId)).toEqual([
    { categoryId, periodMonth: '2026-08-01', amountCents: 120_000 },
  ])
})

it('overwrites the amount for a month rather than adding a second row', async () => {
  const { db, householdId, categoryId } = await seedHousehold()
  await setBudget(db, householdId, { categoryId, period: '2026-08', amountCents: 120_000 })

  await setBudget(db, householdId, { categoryId, period: '2026-08', amountCents: 150_000 })

  const rows = await listBudgets(db, householdId)
  expect(rows).toHaveLength(1)
  expect(rows[0].amountCents).toBe(150_000)
})

it('keeps months independent', async () => {
  const { db, householdId, categoryId } = await seedHousehold()

  await setBudget(db, householdId, { categoryId, period: '2026-08', amountCents: 120_000 })
  await setBudget(db, householdId, { categoryId, period: '2026-12', amountCents: 200_000 })

  const rows = await listBudgets(db, householdId)
  expect(rows.map((r) => [r.periodMonth, r.amountCents])).toEqual([
    ['2026-08-01', 120_000],
    ['2026-12-01', 200_000],
  ])
})

it('clears a month back to having no budget', async () => {
  const { db, householdId, categoryId } = await seedHousehold()
  await setBudget(db, householdId, { categoryId, period: '2026-08', amountCents: 120_000 })

  await clearBudget(db, householdId, { categoryId, period: '2026-08' })

  expect(await listBudgets(db, householdId)).toEqual([])
})

it('refuses a category belonging to another household', async () => {
  const { db, householdId } = await seedHousehold()
  const { categoryId: foreign } = await seedHousehold('other@example.com')

  await expect(
    setBudget(db, householdId, { categoryId: foreign, period: '2026-08', amountCents: 1 }),
  ).rejects.toThrow('UNKNOWN_CATEGORY')

  expect(await listBudgets(db, householdId)).toEqual([])
})

it('rejects a negative amount rather than storing a nonsense budget', async () => {
  const { db, householdId, categoryId } = await seedHousehold()

  await expect(
    setBudget(db, householdId, { categoryId, period: '2026-08', amountCents: -1 }),
  ).rejects.toThrow('INVALID_AMOUNT')
})

it('scopes listing to the household', async () => {
  const { db, householdId, categoryId } = await seedHousehold()
  const { householdId: otherId } = await seedHousehold('other@example.com')
  await setBudget(db, householdId, { categoryId, period: '2026-08', amountCents: 120_000 })

  expect(await listBudgets(db, otherId)).toEqual([])
})
