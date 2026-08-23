import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { setBudget } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { createRule } from '@/lib/db/rules'
import { connections } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { recategorize } from '@/lib/sync/categorize'
import { refreshTransferFlags } from '@/lib/sync/transfers'
import { getForwardView } from '@/lib/views/forward'
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

it('starts at the month after the current one and runs for six months', async () => {
  const { db, householdId } = await seedHousehold()

  const months = await getForwardView(db, householdId, { now: NOW })

  expect(months.map((m) => m.period)).toEqual([
    '2026-09',
    '2026-10',
    '2026-11',
    '2026-12',
    '2027-01',
    '2027-02',
  ])
})

it('shows the instalments already committed to a future month', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const car = await categoryNamed(householdId, 'Manutenção de carro')
  await insertTransaction(db, accountId, {
    description: 'AUTO MECANICA BOA 06/10',
    amountCents: 114_709,
    date: '2026-09-15',
    pluggyCategory: 'Vehicle maintenance',
  })
  await recategorize(db, { householdId })

  const months = await getForwardView(db, householdId, { now: NOW })

  const september = months.find((m) => m.period === '2026-09')!
  expect(september.totalCommittedCents).toBe(114_709)
  expect(september.rows.find((r) => r.categoryId === car)!.committedCents).toBe(114_709)
})

it('counts only instalments, not an ordinary future-dated purchase', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, {
    description: 'COMPRA AVULSA',
    amountCents: 50_000,
    date: '2026-09-20',
    pluggyCategory: 'Groceries',
  })
  await recategorize(db, { householdId })

  const months = await getForwardView(db, householdId, { now: NOW })

  // The forward view answers "what have we already committed to", and a
  // one-off is not a commitment schedule.
  expect(months.find((m) => m.period === '2026-09')!.totalCommittedCents).toBe(0)
})

it('excludes transfers from the committed total', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await insertTransaction(db, accountId, {
    description: 'PAGAMENTO PARC 02/03',
    amountCents: -100_000,
    date: '2026-09-20',
    pluggyCategory: 'Credit card payment',
  })
  // 'Credit card payment' is one of the four Pluggy categories deliberately
  // absent from PLUGGY_CATEGORY_TO_SEED_KEY (lib/domain/pluggy-categories.ts)
  // -- it is a transfer, not spend, so it maps to no budget category.
  // Without a rule this row would keep a null category_id even after
  // recategorize, and the view drops null-category rows before the
  // is_transfer predicate ever runs -- which would make this test pass for
  // the wrong reason. The rule gives the row a real category, the way a
  // household hand-writing one would, so is_transfer is the only thing left
  // that can exclude it from the total below. Do not remove this rule as a
  // "simplification" -- it is what keeps the test honest.
  await createRule(db, householdId, {
    matchType: 'CONTAINS',
    pattern: 'PAGAMENTO',
    categoryId: supermarket,
  })
  await recategorize(db, { householdId })

  // Prove the test's own premise instead of assuming it: the row must
  // actually be categorized before is_transfer can be the thing under test.
  const categorized = await listTransactions(db, householdId, {
    from: '2026-09-01',
    to: '2026-09-30',
    includeTransfers: true,
  })
  expect(categorized.find((t) => t.description === 'PAGAMENTO PARC 02/03')!.categoryId).not.toBe(
    null,
  )

  // The helper leaves is_transfer at its default, exactly as the migration
  // leaves pre-existing rows, so the flag pass has to run first.
  await refreshTransferFlags(db, householdId)

  const months = await getForwardView(db, householdId, { now: NOW })

  expect(months.find((m) => m.period === '2026-09')!.totalCommittedCents).toBe(0)
})

it('carries each month its own resolved budget', async () => {
  const { db, householdId } = await seedHousehold()
  const car = await categoryNamed(householdId, 'Manutenção de carro')
  await setBudget(db, householdId, { categoryId: car, period: '2026-06', amountCents: 50_000 })
  await setBudget(db, householdId, { categoryId: car, period: '2026-11', amountCents: 150_000 })

  const months = await getForwardView(db, householdId, { now: NOW })

  const budgetIn = (period: string) =>
    months.find((m) => m.period === period)!.rows.find((r) => r.categoryId === car)!.budgetCents
  expect(budgetIn('2026-09')).toBe(50_000)
  expect(budgetIn('2026-11')).toBe(150_000)
  expect(budgetIn('2027-01')).toBe(150_000)
})

it('honours a shorter horizon', async () => {
  const { db, householdId } = await seedHousehold()

  const months = await getForwardView(db, householdId, { now: NOW, months: 3 })

  expect(months.map((m) => m.period)).toEqual(['2026-09', '2026-10', '2026-11'])
})

it('never counts another household', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, {
    description: 'AUTO MECANICA BOA 06/10',
    amountCents: 114_709,
    date: '2026-09-15',
    pluggyCategory: 'Vehicle maintenance',
  })
  await recategorize(db, { householdId })
  const { householdId: otherId } = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })

  const months = await getForwardView(db, otherId, { now: NOW })

  expect(months.every((m) => m.totalCommittedCents === 0)).toBe(true)
})
