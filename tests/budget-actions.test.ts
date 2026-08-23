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
const { INVALID_AMOUNT_ERROR, INVALID_PERIOD_ERROR, UNKNOWN_CATEGORY_ERROR } = await import(
  '@/app/(app)/budgets/state'
)

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

// '1.200,50' and '1200.50' must agree -- a Brazilian household writes the
// first, a keyboard often produces the second. '1200' and '1.200' are the
// pair that exercises the thousands-separator rule that tells them apart.
it.each([
  ['1.200,50', 120_050],
  // The R$ prefix is stripped: a household that types the currency in gets
  // the amount it typed, not a rejection.
  ['R$ 1.200,50', 120_050],
  ['1200.50', 120_050],
  ['1200', 120_000],
  ['1.200', 120_000],
])('parses %s as %i centavos', async (raw, amountCents) => {
  const { db, householdId, categories } = await seedHousehold()

  const result = await saveBudgetsAction(
    EMPTY,
    form({ period: '2026-08', [`amount:${categories[0].id}`]: raw }),
  )

  expect(result.error).toBeNull()
  expect(await listBudgets(db, householdId)).toEqual([
    { categoryId: categories[0].id, periodMonth: '2026-08-01', amountCents },
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

it('rolls back the whole submission when one category id belongs to another household', async () => {
  const { db, householdId, categories } = await seedHousehold()
  const other = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other2@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })
  const foreign = (await listCategories(db, other.householdId))[0]

  const result = await saveBudgetsAction(
    EMPTY,
    form({
      period: '2026-08',
      [`amount:${categories[0].id}`]: '100',
      [`amount:${foreign.id}`]: '200',
    }),
  )

  expect(result.error).toBe(UNKNOWN_CATEGORY_ERROR)
  // Proves the first category's write rolled back rather than persisting:
  // the transaction, not just the parse, is all-or-nothing.
  expect(await listBudgets(db, householdId)).toEqual([])
  expect(await listBudgets(db, other.householdId)).toEqual([])
})

it('writes nothing when every field is left untouched', async () => {
  const { db, householdId, categories } = await seedHousehold()
  // A budget in force for August by carry-forward, with no row of its own
  // for October: exactly what the editor pre-fills a field with.
  await saveBudgetsAction(
    EMPTY,
    form({ period: '2026-08', [`amount:${categories[0].id}`]: '1200' }),
  )
  const before = await listBudgets(db, householdId)

  // Opening October and pressing Save without typing anything. The form
  // shows inherited and suggested amounts as PLACEHOLDERS, so an untouched
  // field submits empty -- if it submitted its pre-filled value instead,
  // this one click would materialize an explicit October row for every
  // category, and editing August would stop reaching October forever.
  const result = await saveBudgetsAction(
    EMPTY,
    form(
      Object.fromEntries([
        ['period', '2026-10'],
        ...categories.map((c) => [`amount:${c.id}`, '']),
      ]) as Record<string, string>,
    ),
  )

  expect(result.error).toBeNull()
  expect(await listBudgets(db, householdId)).toEqual(before)
  expect(before).toEqual([
    { categoryId: categories[0].id, periodMonth: '2026-08-01', amountCents: 120_000 },
  ])
})

it('rejects a malformed period as a form error rather than a 500', async () => {
  const { db, householdId, categories } = await seedHousehold()

  const result = await saveBudgetsAction(
    EMPTY,
    form({ period: 'august', [`amount:${categories[0].id}`]: '100' }),
  )

  expect(result.error).toBe(INVALID_PERIOD_ERROR)
  expect(await listBudgets(db, householdId)).toEqual([])
})

it('rejects a category id that could not be a uuid rather than letting Postgres cast it', async () => {
  const { db, householdId } = await seedHousehold()

  const result = await saveBudgetsAction(
    EMPTY,
    form({ period: '2026-08', 'amount:not-a-uuid': '100' }),
  )

  expect(result.error).toBe(UNKNOWN_CATEGORY_ERROR)
  expect(await listBudgets(db, householdId)).toEqual([])
})
