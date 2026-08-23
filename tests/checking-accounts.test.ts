import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { refreshBudgetRoles } from '@/lib/sync/budget-roles'
import { recategorize } from '@/lib/sync/categorize'
import { countUncategorized } from '@/lib/views/inbox'
import { getCategorySpend } from '@/lib/views/spend'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

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
  return { db, householdId, userId }
}

async function addConnection(
  db: ReturnType<typeof testDb>,
  householdId: string,
  userId: string,
  institution: string,
) {
  const [row] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution,
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  return row.id
}

const PERIOD = '2026-08'
const TODAY = '2026-08-20'

it('does not count a card invoice paid from checking as spending', async () => {
  // The required case from the parent spec: the invoice payment leaving
  // checking is the same money as the card transactions it settles. Counted,
  // it doubles the month.
  const { db, householdId, userId } = await seedHousehold()
  const card = await seedAccount(db, await addConnection(db, householdId, userId, 'Nubank'))
  const checking = await seedAccount(
    db,
    await addConnection(db, householdId, userId, 'Itau'),
    { type: 'BANK', name: 'Conta' },
  )

  await insertTransaction(db, card, {
    description: 'ZAFFARI',
    amountCents: 50_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  await insertTransaction(db, checking, {
    description: 'PAGAMENTO FATURA NUBANK',
    amountCents: 50_000,
    date: '2026-08-10',
    pluggyCategory: 'Credit card payment',
  })
  await refreshBudgetRoles(db, householdId)

  const spend = await getCategorySpend(db, householdId, PERIOD, TODAY)
  const total = spend.reduce((sum, row) => sum + row.spentCents, 0)

  expect(total).toBe(50_000)
})

it('does not let salary offset a budget, and keeps it out of the inbox', async () => {
  const { db, householdId, userId } = await seedHousehold()
  const checking = await seedAccount(
    db,
    await addConnection(db, householdId, userId, 'Itau'),
    { type: 'BANK', name: 'Conta' },
  )

  await insertTransaction(db, checking, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  // Money in is a CREDIT, so it reaches the ledger as a negative amount.
  await insertTransaction(db, checking, {
    description: 'SALARIO',
    amountCents: -1_200_000,
    date: '2026-08-05',
    pluggyCategory: 'Salary',
  })
  await refreshBudgetRoles(db, householdId)
  // The real sync/reconcile pipeline always runs recategorize alongside
  // refreshBudgetRoles (lib/sync/reconcile.ts) -- it is what resolves
  // ZAFFARI's 'Groceries' Pluggy category to a household category via the
  // seed map, so it never reaches the inbox. Without it here, ZAFFARI would
  // sit at categoryId = null and be counted as uncategorized, which is a gap
  // in this test's setup rather than in countUncategorized itself.
  await recategorize(db, { householdId })

  const spend = await getCategorySpend(db, householdId, PERIOD, TODAY)
  const total = spend.reduce((sum, row) => sum + row.spentCents, 0)

  expect(total).toBe(30_000)
  // Asking the household to categorize its own salary is noise.
  expect(await countUncategorized(db, householdId)).toBe(0)
})

it('still lets a card refund reduce the category it was bought in', async () => {
  // The guard against an over-broad income list: an estorno is SPEND, and
  // reducing its category is the correct behaviour, not a bug to exclude.
  const { db, householdId, userId } = await seedHousehold()
  const card = await seedAccount(db, await addConnection(db, householdId, userId, 'Nubank'))

  await insertTransaction(db, card, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  await insertTransaction(db, card, {
    description: 'ESTORNO ZAFFARI',
    amountCents: -10_000,
    date: '2026-08-06',
    pluggyCategory: 'Groceries',
  })
  await refreshBudgetRoles(db, householdId)

  const spend = await getCategorySpend(db, householdId, PERIOD, TODAY)
  const total = spend.reduce((sum, row) => sum + row.spentCents, 0)

  expect(total).toBe(20_000)
})

it('totals spend across both connections in the household', async () => {
  const { db, householdId, userId } = await seedHousehold()
  const hers = await seedAccount(db, await addConnection(db, householdId, userId, 'Nubank'))
  const his = await seedAccount(db, await addConnection(db, householdId, userId, 'Itau'))

  await insertTransaction(db, hers, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-05',
    pluggyCategory: 'Groceries',
  })
  await insertTransaction(db, his, {
    description: 'ZAFFARI',
    amountCents: 20_000,
    date: '2026-08-06',
    pluggyCategory: 'Groceries',
  })
  await refreshBudgetRoles(db, householdId)

  const spend = await getCategorySpend(db, householdId, PERIOD, TODAY)
  const total = spend.reduce((sum, row) => sum + row.spentCents, 0)

  expect(total).toBe(50_000)
})
