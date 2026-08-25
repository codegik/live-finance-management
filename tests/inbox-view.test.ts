import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { createRule } from '@/lib/db/rules'
import { connections } from '@/lib/db/schema'
import { refreshBudgetRoles } from '@/lib/sync/budget-roles'
import { countUncategorized, getInboxView } from '@/lib/views/inbox'
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
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution: 'Nubank',
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, connection.id)
  return { db, householdId, accountId }
}

it('groups uncategorized transactions by merchant, biggest total first', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'IFOOD *PEDIDO', amountCents: 5_000, date: '2026-08-02' })
  await insertTransaction(db, accountId, { description: 'ZAFFARI', amountCents: 30_000, date: '2026-08-03' })
  await insertTransaction(db, accountId, { description: 'ZAFFARI', amountCents: 20_000, date: '2026-08-05' })

  const view = await getInboxView(db, householdId)

  expect(view.groups.map((g) => g.merchant)).toEqual(['ZAFFARI', 'IFOOD'])
  expect(view.groups[0]).toMatchObject({ count: 2, totalCents: 50_000, latestDate: '2026-08-05' })
  expect(view.totalCount).toBe(3)
})

it("offers the household's live categories for assignment", async () => {
  const { db, householdId } = await seedHousehold()

  const view = await getInboxView(db, householdId)

  const names = view.categories.map((c) => c.name)
  expect(names).toContain('Supermercado')
  expect(names).not.toContain('')
})

it('keeps transactions with no usable merchant in their own group', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: '*' })

  const view = await getInboxView(db, householdId)

  expect(view.groups).toHaveLength(1)
  expect(view.groups[0].merchant).toBeNull()
  expect(view.groups[0].sampleDescription).toBe('*')
})

it('empties as transactions get categorized', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'ZAFFARI' })
  const [supermarket] = await listCategories(db, householdId)

  expect(await countUncategorized(db, householdId)).toBe(1)
  await createRule(db, householdId, {
    matchType: 'EXACT',
    pattern: 'ZAFFARI',
    categoryId: supermarket.id,
  })

  expect(await countUncategorized(db, householdId)).toBe(0)
  expect((await getInboxView(db, householdId)).groups).toEqual([])
})

it("never shows another household's transactions", async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'ZAFFARI' })
  const { householdId: otherId } = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })

  expect((await getInboxView(db, otherId)).groups).toEqual([])
  expect(await countUncategorized(db, householdId)).toBe(1)
})

it('keeps invoice payments out of the inbox, since they are not work', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, {
    description: 'PAGAMENTO FATURA',
    amountCents: -100_000,
    pluggyCategory: 'Credit card payment',
  })
  await insertTransaction(db, accountId, { description: 'ZAFFARI' })
  await refreshBudgetRoles(db, householdId)

  const view = await getInboxView(db, householdId)

  expect(view.totalCount).toBe(1)
  expect(view.groups.map((g) => g.merchant)).toEqual(['ZAFFARI'])
  expect(await countUncategorized(db, householdId)).toBe(1)
})

it('carries the rows behind each group, newest first', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  for (const [date, amount] of [
    ['2026-08-01', 1_000],
    ['2026-08-17', 2_231],
    ['2026-08-09', 500],
  ] as const) {
    await insertTransaction(db, accountId, {
      description: 'SPREAD DE CAMBIO',
      amountCents: amount,
      date,
    })
  }

  const view = await getInboxView(db, householdId)
  const group = view.groups.find((g) => g.merchant === 'SPREAD DE CAMBIO')!

  // The header's count and total are an aggregate; the detail list has to be
  // the same rows, or the panel contradicts the line that opened it.
  expect(group.count).toBe(3)
  expect(group.transactions).toHaveLength(3)
  expect(group.transactions.reduce((sum, t) => sum + t.amountCents, 0)).toBe(group.totalCents)
  expect(group.transactions.map((t) => t.date)).toEqual([
    '2026-08-17',
    '2026-08-09',
    '2026-08-01',
  ])
  // Which card it was on is the thing a descriptor alone cannot tell you.
  expect(group.transactions[0].accountName).toBeTruthy()
})

it('keeps the rows of the group that has no usable merchant', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: '***', amountCents: 900 })

  const view = await getInboxView(db, householdId)
  const group = view.groups.find((g) => g.merchant === null)

  // Null keys the aggregate and the detail map alike. Dropped, this bucket
  // would show a count with an empty panel behind it.
  expect(group?.transactions).toHaveLength(1)
})
