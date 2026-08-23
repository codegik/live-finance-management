import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listBudgets } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { type BudgetEditorRow, getBudgetEditorView } from '@/lib/views/budget-editor'
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
const { BudgetForm } = await import('@/app/(app)/budgets/BudgetForm')
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

/**
 * What a browser would actually submit from the editor with nothing typed:
 * every amount field's rendered VALUE, and empty for a field that carries
 * only a placeholder. Testing the action against a hand-written FormData
 * cannot see this bug, because the bug is in which of the two the form uses.
 */
function untouchedSubmission(period: string, rows: BudgetEditorRow[]): Record<string, string> {
  const markup = renderToStaticMarkup(createElement(BudgetForm, { period, rows }))
  const submission: Record<string, string> = { period }

  for (const [tag] of markup.matchAll(/<input[^>]*>/g)) {
    const name = /name="(amount:[^"]+)"/.exec(tag)
    if (!name) continue
    const value = /value="([^"]*)"/.exec(tag)
    submission[name[1]] = value ? value[1] : ''
  }

  return submission
}

it("keeps this month's other budgets when one category is edited and saved", async () => {
  const { db, householdId, categories } = await seedHousehold()
  // August's own explicit row: the household committed to it, deliberately.
  await saveBudgetsAction(
    EMPTY,
    form({ period: '2026-08', [`amount:${categories[0].id}`]: '1200' }),
  )

  // It comes back to the SAME month, types an amount into a DIFFERENT
  // category, and saves. Everything else is untouched, so it submits
  // whatever the editor rendered -- which is the whole question: an amount
  // this month already owns has to round-trip as a value, or the action
  // reads the empty field as "clear" and deletes it with no warning.
  const view = await getBudgetEditorView(db, householdId, '2026-08')
  const submission = untouchedSubmission('2026-08', view.rows)
  submission[`amount:${categories[1].id}`] = '500'

  const result = await saveBudgetsAction(EMPTY, form(submission))

  expect(result.error).toBeNull()
  const stored = await listBudgets(db, householdId)
  expect(stored).toContainEqual({
    categoryId: categories[0].id,
    periodMonth: '2026-08-01',
    amountCents: 120_000,
  })
  expect(stored).toContainEqual({
    categoryId: categories[1].id,
    periodMonth: '2026-08-01',
    amountCents: 50_000,
  })
  // And nothing else: the untouched categories, which carry only a
  // suggestion or nothing at all, still write no row of their own.
  expect(stored).toHaveLength(2)
})

it('does not materialize an inherited amount into a month of its own', async () => {
  const { db, householdId, categories } = await seedHousehold()
  await saveBudgetsAction(
    EMPTY,
    form({ period: '2026-08', [`amount:${categories[0].id}`]: '1200' }),
  )
  const before = await listBudgets(db, householdId)

  // October inherits August's 1.200 -- it has no row of its own. Opening
  // October and saving must leave it that way, or editing August stops
  // reaching October forever.
  const view = await getBudgetEditorView(db, householdId, '2026-10')
  expect(view.rows.find((r) => r.categoryId === categories[0].id)?.inheritedFrom).toBe('2026-08')

  const result = await saveBudgetsAction(EMPTY, form(untouchedSubmission('2026-10', view.rows)))

  expect(result.error).toBeNull()
  expect(await listBudgets(db, householdId)).toEqual(before)
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
