import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { setBudget } from '@/lib/db/budgets'
import { archiveCategory, listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { recategorize } from '@/lib/sync/categorize'
import { refreshBudgetRoles } from '@/lib/sync/budget-roles'
import { getMonthView, type MonthRow } from '@/lib/views/month'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

/** The 10th of August, so 10 days elapsed of 31. */
const NOW = new Date('2026-08-10T15:00:00.000Z')

const PERIOD = '2026-08'

/**
 * The month view groups its rows into the four blocks of the household's
 * sheet. These tests are about arithmetic, not about which block a category
 * sits in, so they flatten it back to one list.
 */
function allRows(view: { groups: { rows: MonthRow[] }[] }): MonthRow[] {
  return view.groups.flatMap((group) => group.rows)
}

/** Everything that left the household, investments included. */
function totalSpent(view: { expenseCents: number; investedCents: number }): number {
  return view.expenseCents + view.investedCents
}

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

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  expect(view.period).toBe('2026-08')
  expect(view.stance).toBe('CURRENT')
  const row = allRows(view).find((r) => r.categoryId === supermarket)!
  expect(row).toMatchObject({
    categoryName: 'Supermercado',
    actualCents: 30_000,
    variableCents: 30_000,
    committedCents: 0,
    plannedCents: 120_000,
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

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  const row = allRows(view).find((r) => r.categoryId === car)!
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

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  expect(totalSpent(view)).toBe(30_000)
  expect(allRows(view).every((r) => r.actualCents >= 0)).toBe(true)
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

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  expect(totalSpent(view)).toBe(20_000)
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

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  expect(allRows(view).find((r) => r.categoryId === supermarket)!.plannedCents).toBe(90_000)
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

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  // find(), not rows[0]: which category sorts first is a display decision
  // (category.sortOrder), and this assertion is not about that.
  expect(allRows(view).find((r) => r.categoryId === supermarket)!.plannedCents).toBeNull()
  expect(view.plannedExpenseCents).toBe(0)
})

it('reports uncategorized spend separately rather than hiding it', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, {
    description: 'ALGO DESCONHECIDO',
    amountCents: 5_000,
    date: '2026-08-05',
  })

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  expect(view.uncategorizedSpentCents).toBe(5_000)
  expect(view.uncategorizedCount).toBe(1)
  // It is real money, so it belongs in the total.
  expect(totalSpent(view)).toBe(5_000)
  expect(allRows(view).every((r) => r.categoryId !== null)).toBe(true)
})

it('carries the transactions behind the uncategorized figure', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  for (const [date, amount] of [
    ['2026-08-05', 5_000],
    ['2026-08-19', 1_250],
  ] as const) {
    await insertTransaction(db, accountId, {
      description: 'ALGO DESCONHECIDO',
      amountCents: amount,
      date,
    })
  }

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  // "Não categorizado" is not a category row, so nothing else can answer
  // "what IS that?" for it. The list has to be the same rows the figure was
  // summed from, or the panel contradicts the number that opened it.
  expect(view.uncategorizedDetail.transactionCount).toBe(2)
  expect(
    view.uncategorizedDetail.transactions.reduce((sum, t) => sum + t.amountCents, 0),
  ).toBe(view.uncategorizedSpentCents)
  expect(view.uncategorizedDetail.transactions.map((t) => t.date)).toEqual([
    '2026-08-19',
    '2026-08-05',
  ])
  // Null, not some arbitrary category: the inline picker reads this to decide
  // whether to offer a real selection or a disabled "a categorizar", and a
  // preselected category would present an unfiled charge as already filed.
  expect(view.uncategorizedDetail.transactions.every((t) => t.categoryId === null)).toBe(true)
  expect(view.uncategorizedDetail.transactions[0].accountName).toBeTruthy()
})

it('carries connection health so a month can never read as on track while stale', async () => {
  const { db, householdId } = await seedHousehold()

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

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

  const view = await getMonthView(db, otherId, PERIOD, { now: NOW })

  // The other household has its own seeded taxonomy, so it has rows -- they
  // must simply all be empty.
  expect(totalSpent(view)).toBe(0)
  expect(allRows(view).every((r) => r.actualCents === 0)).toBe(true)
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

  const before = await getMonthView(db, householdId, PERIOD, { now: NOW })
  // The premise, asserted rather than assumed: the spend really is attached
  // to the category about to be archived. Without this, archiving a category
  // with nothing on it would "prove" the fix while proving nothing.
  expect(allRows(before).find((r) => r.categoryId === supermarket)!.actualCents).toBe(30_000)
  expect(totalSpent(before)).toBe(30_000)

  await archiveCategory(db, householdId, supermarket)

  const after = await getMonthView(db, householdId, PERIOD, { now: NOW })

  // Archived, so it is not drawn...
  expect(allRows(after).some((r) => r.categoryId === supermarket)).toBe(false)
  // ...and archiving reassigned nothing, so the row is not uncategorized
  // either -- it is in neither of the two buckets the old total added up.
  expect(after.uncategorizedSpentCents).toBe(0)
  expect(after.uncategorizedCount).toBe(0)
  // The money is real, is not a transfer, and /ledger still shows it.
  expect(totalSpent(after)).toBe(30_000)
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

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  expect(view.uncategorizedCount).toBe(1)
  expect(view.uncategorizedSpentCents).toBe(5_000)
})

// --- The blocks, and the money that only they can show -----------------

it('reads Receita from income rows and points it the same way as spending', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const bank = await seedAccount(db, (await db.select().from(connections))[0].id, {
    type: 'BANK',
    name: 'Checking',
  })
  // Stored as a credit, so negative centavos (lib/domain/money.ts). The view
  // must flip it: a household that earned R$ 49.550 must not read -49.550.
  await insertTransaction(db, bank, {
    description: 'SALARIO',
    amountCents: -49_550_00,
    date: '2026-08-05',
    pluggyCategory: 'Salary',
  })
  await refreshBudgetRoles(db, householdId)
  await recategorize(db, { householdId })

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  expect(view.incomeCents).toBe(49_550_00)
  const receita = view.groups.find((g) => g.group === 'RECEITA')!
  expect(receita.actualCents).toBe(49_550_00)
  expect(receita.rows.find((r) => r.categoryName === 'Salário')!.actualCents).toBe(49_550_00)
  // Salary is not spending, and must not appear as any.
  expect(view.expenseCents).toBe(0)
  expect(totalSpent(view)).toBe(0)
  void accountId
})

it('leaves salary out of the spending blocks entirely', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  const bank = await seedAccount(db, (await db.select().from(connections))[0].id, { type: 'BANK' })
  await insertTransaction(db, bank, {
    description: 'SALARIO',
    amountCents: -49_550_00,
    date: '2026-08-05',
    pluggyCategory: 'Salary',
  })
  await refreshBudgetRoles(db, householdId)
  await recategorize(db, { householdId })

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  expect(view.expenseCents).toBe(30_000)
  expect(view.netCents).toBe(49_550_00 - 30_000)
  for (const group of view.groups) {
    if (group.group === 'RECEITA') continue
    expect(group.actualCents).toBeGreaterThanOrEqual(0)
  }
})

it('puts the spend of an archived category in a row of its own rather than losing it', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  await recategorize(db, { householdId })
  await archiveCategory(db, householdId, supermarket)

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  // Not drawn as a category row, but named and totalled all the same -- the
  // rows on screen and the Despesas figure above them must add up.
  expect(view.archivedSpentCents).toBe(30_000)
  expect(view.uncategorizedSpentCents).toBe(0)
  expect(view.expenseCents).toBe(30_000)

  // And openable, for the same reason it is named: a figure nobody can
  // interrogate is a figure that gets disbelieved. The row still points at the
  // archived category, which is where it legitimately rests.
  expect(view.archivedDetail.transactionCount).toBe(1)
  expect(view.archivedDetail.transactions[0].amountCents).toBe(view.archivedSpentCents)
  expect(view.archivedDetail.transactions[0].categoryId).toBe(supermarket)
})

// --- Where the month sits relative to today ----------------------------

it('never extrapolates a month that has already closed', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-06-05',
    pluggyCategory: 'Groceries',
  })
  await recategorize(db, { householdId })

  const view = await getMonthView(db, householdId, '2026-06', { now: NOW })

  expect(view.stance).toBe('PAST')
  const row = allRows(view).find((r) => r.categoryId === supermarket)!
  // June is over. Pacing it would forecast spending that provably never
  // happened -- the figure is simply what happened.
  expect(row.paceCents).toBe(30_000)
  expect(view.elapsedDays).toBe(30)
})

it('shows a future month as nothing but what is already committed to it', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const car = await categoryNamed(householdId, 'Manutenção de carro')
  await insertTransaction(db, accountId, {
    description: 'AUTO MECANICA BOA 07/10',
    amountCents: 114_709,
    date: '2026-10-17',
    pluggyCategory: 'Vehicle maintenance',
  })
  await recategorize(db, { householdId })

  const view = await getMonthView(db, householdId, '2026-10', { now: NOW })

  expect(view.stance).toBe('FUTURE')
  expect(view.elapsedDays).toBe(0)
  const row = allRows(view).find((r) => r.categoryId === car)!
  expect(row.committedCents).toBe(114_709)
  // Nothing has been spent in a month that has not started, so there is no
  // rate to extrapolate from -- only the commitment.
  expect(row.paceCents).toBe(114_709)
})

it('reports what share of the income was set aside, and says nothing when there was none', async () => {
  const { db, householdId } = await seedHousehold()
  const bank = await seedAccount(db, (await db.select().from(connections))[0].id, { type: 'BANK' })
  await insertTransaction(db, bank, {
    description: 'SALARIO',
    amountCents: -100_000_00,
    date: '2026-08-05',
    pluggyCategory: 'Salary',
  })
  await refreshBudgetRoles(db, householdId)
  await recategorize(db, { householdId })

  const withIncome = await getMonthView(db, householdId, PERIOD, { now: NOW })
  expect(withIncome.investedShareOfIncome).toBe(0)

  // A month with no income recorded must read as "not known", never as 0% and
  // never as Infinity.
  const noIncome = await getMonthView(db, householdId, '2026-07', { now: NOW })
  expect(noIncome.investedShareOfIncome).toBeNull()
})

it('never renders a month with no income as having earned minus nothing', async () => {
  const { db, householdId } = await seedHousehold()

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  // `-0` is a real JavaScript value, `0 * -1` produces it, and Intl formats it
  // as "-R$ 0,00". It reached the headline figure of the month screen.
  expect(Object.is(view.incomeCents, -0)).toBe(false)
  for (const row of allRows(view)) {
    expect(Object.is(row.actualCents, -0)).toBe(false)
    expect(Object.is(row.committedCents, -0)).toBe(false)
    expect(Object.is(row.variableCents, -0)).toBe(false)
  }
})

it('carries the transactions behind each category figure', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  for (const [date, amount] of [
    ['2026-08-05', 30_000],
    ['2026-08-19', 12_550],
  ] as const) {
    await insertTransaction(db, accountId, {
      description: 'ZAFFARI',
      amountCents: amount,
      date,
      pluggyCategory: 'Groceries',
    })
  }
  await recategorize(db, { householdId })

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })
  const row = allRows(view).find((r) => r.categoryId === supermarket)!

  // The figure is an aggregate; the list has to be the same rows, or the panel
  // contradicts the number that opened it.
  expect(row.transactionCount).toBe(2)
  expect(row.transactions.reduce((sum, t) => sum + t.amountCents, 0)).toBe(row.actualCents)
  expect(row.transactions.map((t) => t.date)).toEqual(['2026-08-19', '2026-08-05'])
  expect(row.transactions[0].accountName).toBeTruthy()
})

it('points a Receita transaction the same way its row points', async () => {
  const { db, householdId } = await seedHousehold()
  const bank = await seedAccount(db, (await db.select().from(connections))[0].id, { type: 'BANK' })
  await insertTransaction(db, bank, {
    description: 'SALARIO',
    amountCents: -49_550_00,
    date: '2026-08-05',
    pluggyCategory: 'Salary',
  })
  await refreshBudgetRoles(db, householdId)
  await recategorize(db, { householdId })

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })
  const row = view.groups
    .find((g) => g.group === 'RECEITA')!
    .rows.find((r) => r.categoryName === 'Salário')!

  // Income is stored negative. A row reading R$ 49.550,00 whose detail list
  // reads -R$ 49.550,00 is worse than no detail list at all.
  expect(row.transactions[0].amountCents).toBe(49_550_00)
  expect(row.transactions[0].amountCents).toBe(row.actualCents)
})

it('names which instalment a repeated figure is', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, {
    description: 'AUTO MECANICA BOA 05/10',
    amountCents: 114_709,
    date: '2026-08-17',
    pluggyCategory: 'Vehicle maintenance',
  })
  await recategorize(db, { householdId })

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })
  const row = allRows(view).find((r) => r.categoryName === 'Manutenção de carro')!

  // R$ 1.147,09 appearing in ten consecutive months is unexplainable without
  // this.
  expect(row.transactions[0].installment).toBe('5/10')
})

// --- A connected checking account. Every one of these was invisible before:
// --- Pluggy labels a PIX 'Transfers', and that string excluded the row from
// --- every budgeting figure.

it('shows an outgoing PIX as spending in the month view', async () => {
  const { db, householdId } = await seedHousehold()
  const checking = await seedAccount(db, (await db.select().from(connections))[0].id, {
    type: 'BANK',
    name: 'Nu Pagamentos',
  })
  await insertTransaction(db, checking, {
    description: 'PIX ENVIADO JOAO',
    amountCents: 50_000,
    date: '2026-08-05',
    pluggyCategory: 'Transfers',
  })
  await refreshBudgetRoles(db, householdId)

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  expect(view.expenseCents).toBe(50_000)
  // Uncategorized, so it lands in the inbox where the household files it --
  // visible, rather than silently dropped.
  expect(view.uncategorizedCount).toBe(1)
})

it('shows an arriving PIX as Receita', async () => {
  const { db, householdId } = await seedHousehold()
  const checking = await seedAccount(db, (await db.select().from(connections))[0].id, {
    type: 'BANK',
  })
  await insertTransaction(db, checking, {
    description: 'PIX RECEBIDO',
    amountCents: -80_000,
    date: '2026-08-05',
    pluggyCategory: 'Transfers',
  })
  await refreshBudgetRoles(db, householdId)

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  expect(view.incomeCents).toBe(80_000)
  expect(view.expenseCents).toBe(0)
})

it('still never counts the invoice payment leaving checking', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const checking = await seedAccount(db, (await db.select().from(connections))[0].id, {
    type: 'BANK',
  })
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  await insertTransaction(db, checking, {
    description: 'PAGAMENTO FATURA CARTAO',
    amountCents: 30_000,
    date: '2026-08-10',
    pluggyCategory: 'Credit card payment',
  })
  await refreshBudgetRoles(db, householdId)
  await recategorize(db, { householdId })

  const view = await getMonthView(db, householdId, PERIOD, { now: NOW })

  // The card purchase is already counted in the month its fatura falls due.
  // Counting the payment that settles it would count every card purchase twice.
  expect(view.expenseCents).toBe(30_000)
})
