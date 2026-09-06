import { eq } from 'drizzle-orm'
import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import {
  clearRecurringExpense,
  listRecurringExpenses,
  matchesRecurring,
  projectedAmountCents,
  projectsInPeriod,
  resolveRecurring,
  setRecurringExpense,
  type RecurringMatcher,
} from '@/lib/db/recurring-expenses'
import { connections, transactions } from '@/lib/db/schema'
import { getMonthView } from '@/lib/views/month'
import { resetDb, testDb } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(resetDb)

/** A household with two SPEND categories -- recurring items are filed under a
 *  category, so the resolver's category scope needs two ids to tell apart. */
async function seedHousehold() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const categories = await listCategories(db, householdId)
  return { db, householdId, userId, categories }
}

/** A matcher literal for the pure-function tests, defaulted so a test names only
 *  the fields it cares about. */
function matcher(partial: Partial<RecurringMatcher>): RecurringMatcher {
  return {
    id: partial.id ?? crypto.randomUUID(),
    matchType: partial.matchType ?? 'CONTAINS',
    pattern: partial.pattern ?? 'PATTERN',
    title: partial.title ?? 'Item',
    categoryId: partial.categoryId ?? 'cat-1',
    amountCents: partial.amountCents ?? null,
    dayOfMonth: partial.dayOfMonth ?? 15,
    cadence: partial.cadence ?? 'MONTHLY',
    anchorMonth: partial.anchorMonth ?? '2026-01-01',
    endMonth: partial.endMonth ?? null,
  }
}

// --- the pure matcher ------------------------------------------------------

it('resolveRecurring matches like a rule: EXACT and CONTAINS, most specific first', () => {
  // Ordered as listRecurringExpenses returns them: EXACT before CONTAINS.
  const items = [
    matcher({ matchType: 'EXACT', pattern: 'COLISEU OLD GYM PORTO', title: 'Academia Porto', categoryId: 'saude' }),
    matcher({ matchType: 'CONTAINS', pattern: 'COLISEU OLD GYM', title: 'Academia', categoryId: 'saude' }),
  ]

  // CONTAINS catches every instalment descriptor, whatever the branch noise.
  expect(resolveRecurring(items, 'COLISEU OLD GYM SUL', 'saude')?.title).toBe('Academia')
  // EXACT wins over the broad CONTAINS on the descriptor it names exactly.
  expect(resolveRecurring(items, 'COLISEU OLD GYM PORTO', 'saude')?.title).toBe('Academia Porto')
  // No match, and a null merchant, both fall through to no recurrence.
  expect(resolveRecurring(items, 'ZAFFARI', 'saude')).toBeNull()
  expect(resolveRecurring(items, null, 'saude')).toBeNull()
})

it('resolveRecurring only matches within its own category', () => {
  const items = [matcher({ pattern: 'ZAFFARI', title: 'Mercado', categoryId: 'super' })]

  // The same merchant billed under a different category is not this item.
  expect(resolveRecurring(items, 'ZAFFARI PORTO', 'super')?.title).toBe('Mercado')
  expect(resolveRecurring(items, 'ZAFFARI PORTO', 'lazer')).toBeNull()
  // Undefined category matches on merchant alone.
  expect(resolveRecurring(items, 'ZAFFARI PORTO')?.title).toBe('Mercado')
})

it('matchesRecurring applies the EXACT/CONTAINS test the resolver is built on', () => {
  expect(matchesRecurring({ matchType: 'CONTAINS', pattern: 'NETFLIX' }, 'NETFLIX COM')).toBe(true)
  expect(matchesRecurring({ matchType: 'EXACT', pattern: 'NETFLIX' }, 'NETFLIX COM')).toBe(false)
  expect(matchesRecurring({ matchType: 'EXACT', pattern: 'NETFLIX' }, 'NETFLIX')).toBe(true)
  expect(matchesRecurring({ matchType: 'CONTAINS', pattern: 'NETFLIX' }, null)).toBe(false)
})

// --- the cadence / window gate ---------------------------------------------

it('projectsInPeriod honours the window and the cadence', () => {
  const monthly = matcher({ cadence: 'MONTHLY', anchorMonth: '2026-08-01', endMonth: null })
  // Not before it starts, then every month after.
  expect(projectsInPeriod(monthly, '2026-07')).toBe(false)
  expect(projectsInPeriod(monthly, '2026-08')).toBe(true)
  expect(projectsInPeriod(monthly, '2027-03')).toBe(true)

  // A closed window stops projecting past its end.
  const ended = matcher({ cadence: 'MONTHLY', anchorMonth: '2026-01-01', endMonth: '2026-06-01' })
  expect(projectsInPeriod(ended, '2026-06')).toBe(true)
  expect(projectsInPeriod(ended, '2026-07')).toBe(false)

  // ANNUAL lands only in the month of the year its anchor names.
  const annual = matcher({ cadence: 'ANNUAL', anchorMonth: '2026-01-01', endMonth: null })
  expect(projectsInPeriod(annual, '2026-01')).toBe(true)
  expect(projectsInPeriod(annual, '2026-02')).toBe(false)
  expect(projectsInPeriod(annual, '2027-01')).toBe(true)

  // ONCE lands in its anchor month only -- never before, never the month after,
  // and never the same month a year on.
  const once = matcher({ cadence: 'ONCE', anchorMonth: '2026-08-01', endMonth: null })
  expect(projectsInPeriod(once, '2026-07')).toBe(false)
  expect(projectsInPeriod(once, '2026-08')).toBe(true)
  expect(projectsInPeriod(once, '2026-09')).toBe(false)
  expect(projectsInPeriod(once, '2027-08')).toBe(false)
})

// --- the rolling average ---------------------------------------------------

it('projectedAmountCents uses the stored amount when fixed, the rolling average when variable', () => {
  // Fixed: the stored amount, history ignored.
  expect(projectedAmountCents({ amountCents: 5500 }, [9999, 1])).toBe(5500)

  // Variable: mean of the last `window` matched charges, newest first.
  expect(projectedAmountCents({ amountCents: null }, [12000, 10000, 8000, 100])).toBe(10000)
  // Rounds to the nearest cent.
  expect(projectedAmountCents({ amountCents: null }, [100, 101])).toBe(101)
  // No history yet: an honest zero, not an invented number.
  expect(projectedAmountCents({ amountCents: null }, [])).toBe(0)
})

// --- the db round-trip -----------------------------------------------------

it('set normalizes the pattern, upserts in place, and clear removes it', async () => {
  const { db, householdId, categories } = await seedHousehold()
  const categoryId = categories[0].id

  // Typed with accents and mixed case -- normalizeMerchant folds it to the
  // stored form, exactly as a merchant label does.
  const first = await setRecurringExpense(db, householdId, {
    matchType: 'CONTAINS',
    pattern: 'Coliseu Old Gym',
    title: 'Academia',
    categoryId,
    amountCents: 13790,
    dayOfMonth: 15,
    cadence: 'MONTHLY',
    anchorMonth: '2026-08-01',
  })
  expect(first.ok).toBe(true)

  let items = await listRecurringExpenses(db, householdId)
  expect(items).toHaveLength(1)
  expect(items[0].pattern).toBe('COLISEU OLD GYM')
  expect(items[0].title).toBe('Academia')
  expect(items[0].amountCents).toBe(13790)

  // Re-typing the same (matchType, pattern) updates in place, not stacks a row.
  await setRecurringExpense(db, householdId, {
    matchType: 'CONTAINS',
    pattern: 'COLISEU OLD GYM',
    title: 'Academia mensal',
    categoryId,
    amountCents: null,
    dayOfMonth: 10,
    cadence: 'MONTHLY',
    anchorMonth: '2026-08-01',
  })
  items = await listRecurringExpenses(db, householdId)
  expect(items).toHaveLength(1)
  expect(items[0].title).toBe('Academia mensal')
  expect(items[0].amountCents).toBeNull()
  expect(items[0].dayOfMonth).toBe(10)

  // A pattern with nothing to match on cannot be stored.
  const bad = await setRecurringExpense(db, householdId, {
    matchType: 'EXACT',
    pattern: '***',
    title: 'x',
    categoryId,
    amountCents: 1,
    dayOfMonth: 1,
    cadence: 'MONTHLY',
    anchorMonth: '2026-08-01',
  })
  expect(bad.ok).toBe(false)

  await clearRecurringExpense(db, householdId, { matchType: 'CONTAINS', pattern: 'coliseu old gym' })
  expect(await listRecurringExpenses(db, householdId)).toHaveLength(0)
})

it('list returns most-specific-first and omits inactive items', async () => {
  const { db, householdId, categories } = await seedHousehold()
  const categoryId = categories[0].id

  await setRecurringExpense(db, householdId, {
    matchType: 'CONTAINS', pattern: 'GYM', title: 'broad', categoryId,
    amountCents: 100, dayOfMonth: 1, cadence: 'MONTHLY', anchorMonth: '2026-08-01',
  })
  await setRecurringExpense(db, householdId, {
    matchType: 'EXACT', pattern: 'COLISEU OLD GYM', title: 'exact', categoryId,
    amountCents: 200, dayOfMonth: 1, cadence: 'MONTHLY', anchorMonth: '2026-08-01',
  })
  await setRecurringExpense(db, householdId, {
    matchType: 'CONTAINS', pattern: 'COLISEU OLD GYM', title: 'longer', categoryId,
    amountCents: 300, dayOfMonth: 1, cadence: 'MONTHLY', anchorMonth: '2026-08-01',
  })

  const items = await listRecurringExpenses(db, householdId)
  // EXACT first, then the longer CONTAINS, then the short one.
  expect(items.map((i) => i.title)).toEqual(['exact', 'longer', 'broad'])
})

// --- through the month view ------------------------------------------------

const NOW = new Date('2026-08-25T12:00:00.000Z')

/** A household with a card, so a real charge can be filed under a category and
 *  matched against a recurring definition the way the dashboard does it. */
async function seedWithCard() {
  const { db, householdId, userId, categories } = await seedHousehold()
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution: 'Nubank',
    })
    .returning({ id: connections.id })
  const cardId = await seedAccount(db, connection.id, { type: 'CREDIT' })
  // A drawn category row needs a SPEND-role category to sit on.
  const category = categories.find((c) => c.group === 'DESPESA_FIXA')!
  return { db, householdId, cardId, categoryId: category.id }
}

/** insertTransaction leaves a row uncategorized; file it under a category so a
 *  category row is drawn from it. */
async function fileCharge(
  db: ReturnType<typeof testDb>,
  cardId: string,
  categoryId: string,
  over: { description: string; amountCents?: number; date?: string },
) {
  const id = await insertTransaction(db, cardId, over)
  await db.update(transactions).set({ categoryId }).where(eq(transactions.id, id))
  return id
}

it('projects an unfulfilled recurring item in a future month, at its fixed amount', async () => {
  const { db, householdId, categoryId } = await seedWithCard()
  await setRecurringExpense(db, householdId, {
    matchType: 'CONTAINS', pattern: 'NETFLIX', title: 'Netflix', categoryId,
    amountCents: 5500, dayOfMonth: 15, cadence: 'MONTHLY', anchorMonth: '2026-08-01',
  })

  // October is a future month with nothing filed: the line is drawn, and the
  // money is a forecast (recurringCents), never spend (actualCents/expenseCents).
  const month = await getMonthView(db, householdId, '2026-10', { now: NOW })
  const row = month.groups
    .flatMap((g) => g.rows)
    .find((r) => r.categoryId === categoryId)!
  expect(row.recurringLines.map((l) => l.title)).toEqual(['Netflix'])
  expect(row.recurringLines[0].amountCents).toBe(5500)
  expect(row.recurringLines[0].estimated).toBe(false)
  // The day (15) resolved onto the viewed month (October), for the date column.
  expect(row.recurringLines[0].date).toBe('2026-10-15')
  expect(row.recurringCents).toBe(5500)
  expect(row.actualCents).toBe(0)
  expect(month.recurringCents).toBe(5500)
  expect(month.expenseCents).toBe(0)
})

it('suppresses the projection once a matching real charge lands (no double count)', async () => {
  const { db, householdId, cardId, categoryId } = await seedWithCard()
  await setRecurringExpense(db, householdId, {
    matchType: 'CONTAINS', pattern: 'NETFLIX', title: 'Netflix', categoryId,
    amountCents: 5500, dayOfMonth: 15, cadence: 'MONTHLY', anchorMonth: '2026-08-01',
  })

  // The real August charge fulfils the recurrence, so the current month draws
  // no forecast line -- only the charge itself.
  await fileCharge(db, cardId, categoryId, {
    description: 'NETFLIX COM',
    amountCents: 5500,
    date: '2026-08-15',
  })
  const month = await getMonthView(db, householdId, '2026-08', { now: NOW })
  const row = month.groups
    .flatMap((g) => g.rows)
    .find((r) => r.categoryId === categoryId)!
  expect(row.recurringLines).toHaveLength(0)
  expect(row.recurringCents).toBe(0)
  expect(row.actualCents).toBe(5500)
  // The charge that fulfilled it is badged, and its "make recurring" glyph is
  // withheld downstream because of this flag.
  expect(row.transactions[0].recurring).toBe(true)
})

it('a real charge with a different amount overrides the forecast for that month', async () => {
  const { db, householdId, cardId, categoryId } = await seedWithCard()
  await setRecurringExpense(db, householdId, {
    matchType: 'CONTAINS', pattern: 'NETFLIX', title: 'Netflix', categoryId,
    amountCents: 5500, dayOfMonth: 15, cadence: 'MONTHLY', anchorMonth: '2026-08-01',
  })
  // A price rise: the real charge is R$ 62,90, not the R$ 55,00 forecast. It
  // still matches, so the month shows the real amount and no forecast -- the
  // recurrence is overridden for August, and untouched for other months.
  await fileCharge(db, cardId, categoryId, {
    description: 'NETFLIX COM',
    amountCents: 6290,
    date: '2026-08-17',
  })
  const month = await getMonthView(db, householdId, '2026-08', { now: NOW })
  const row = month.groups.flatMap((g) => g.rows).find((r) => r.categoryId === categoryId)!
  expect(row.recurringLines).toHaveLength(0)
  expect(row.actualCents).toBe(6290)
  expect(row.transactions[0].recurring).toBe(true)
})

it('projects a variable item from the rolling average of its matched history', async () => {
  const { db, householdId, cardId, categoryId } = await seedWithCard()
  await setRecurringExpense(db, householdId, {
    matchType: 'CONTAINS', pattern: 'CEEE', title: 'Luz', categoryId,
    amountCents: null, dayOfMonth: 10, cadence: 'MONTHLY', anchorMonth: '2026-05-01',
  })
  // Two prior months of the bill, different amounts; average is 15000.
  await fileCharge(db, cardId, categoryId, { description: 'CEEE ENERGIA', amountCents: 18000, date: '2026-06-10' })
  await fileCharge(db, cardId, categoryId, { description: 'CEEE ENERGIA', amountCents: 12000, date: '2026-07-10' })

  // October has no CEEE charge yet: the forecast is the average of the two, and
  // it reads as an estimate.
  const month = await getMonthView(db, householdId, '2026-10', { now: NOW })
  const row = month.groups.flatMap((g) => g.rows).find((r) => r.categoryId === categoryId)!
  expect(row.recurringLines[0].estimated).toBe(true)
  expect(row.recurringLines[0].amountCents).toBe(15000)
})

it('does not project into a closed past month', async () => {
  const { db, householdId, categoryId } = await seedWithCard()
  await setRecurringExpense(db, householdId, {
    matchType: 'CONTAINS', pattern: 'NETFLIX', title: 'Netflix', categoryId,
    amountCents: 5500, dayOfMonth: 15, cadence: 'MONTHLY', anchorMonth: '2026-01-01',
  })
  const month = await getMonthView(db, householdId, '2026-07', { now: NOW })
  const row = month.groups.flatMap((g) => g.rows).find((r) => r.categoryId === categoryId)
  // Nothing filed and no plan: the row is not even drawn, and nothing is forecast.
  expect(row?.recurringLines ?? []).toHaveLength(0)
  expect(month.recurringCents).toBe(0)
})
