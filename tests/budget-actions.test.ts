import { beforeEach, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listBudgets } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { resetDb, testDb, useTestEnv } from './helpers/db'

const session = vi.hoisted(() => ({ current: { householdId: '', userId: '' } }))
vi.mock('@/lib/auth/session', () => ({
  requireSession: async () => session.current,
  toSignInOrThrow: () => {
    throw new Error('UNAUTHENTICATED')
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { saveBudgetsAction } = await import('@/app/(app)/budgets/actions')
const { INVALID_AMOUNT_ERROR } = await import('@/app/(app)/budgets/state')

const EMPTY = { error: null, message: null }

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
  session.current = { householdId, userId }
  const categories = await listCategories(db, householdId)
  return { db, householdId, categories }
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

it('saves the amounts that were filled in, in reais, as centavos', async () => {
  const { db, householdId, categories } = await seedHousehold()

  const result = await saveBudgetsAction(
    EMPTY,
    form({ period: '2026-08', [`amount:${categories[0].id}`]: '1200,50' }),
  )

  expect(result.error).toBeNull()
  expect(await listBudgets(db, householdId)).toEqual([
    { categoryId: categories[0].id, periodMonth: '2026-08-01', amountCents: 120_050 },
  ])
})

it('leaves a blank field unbudgeted rather than storing zero', async () => {
  const { db, householdId, categories } = await seedHousehold()

  await saveBudgetsAction(
    EMPTY,
    form({ period: '2026-08', [`amount:${categories[0].id}`]: '' }),
  )

  expect(await listBudgets(db, householdId)).toEqual([])
})

it('clears a budget that had been set when its field is emptied', async () => {
  const { db, householdId, categories } = await seedHousehold()
  await saveBudgetsAction(
    EMPTY,
    form({ period: '2026-08', [`amount:${categories[0].id}`]: '100' }),
  )

  await saveBudgetsAction(
    EMPTY,
    form({ period: '2026-08', [`amount:${categories[0].id}`]: '' }),
  )

  expect(await listBudgets(db, householdId)).toEqual([])
})

it('rejects an unparseable amount without saving anything else', async () => {
  const { db, householdId, categories } = await seedHousehold()

  const result = await saveBudgetsAction(
    EMPTY,
    form({
      period: '2026-08',
      [`amount:${categories[0].id}`]: 'muito',
      [`amount:${categories[1].id}`]: '300',
    }),
  )

  expect(result.error).toBe(INVALID_AMOUNT_ERROR)
  // All or nothing: a half-saved budget screen is worse than a rejected one.
  expect(await listBudgets(db, householdId)).toEqual([])
})

it("ignores a category id that is not this household's", async () => {
  const { db, householdId } = await seedHousehold()
  const other = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })
  const foreign = (await listCategories(db, other.householdId))[0]

  const result = await saveBudgetsAction(
    EMPTY,
    form({ period: '2026-08', [`amount:${foreign.id}`]: '100' }),
  )

  expect(result.error).not.toBeNull()
  expect(await listBudgets(db, householdId)).toEqual([])
  expect(await listBudgets(db, other.householdId)).toEqual([])
})
