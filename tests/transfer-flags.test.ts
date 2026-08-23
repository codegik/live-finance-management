import { eq } from 'drizzle-orm'
import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { connections, transactions } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { refreshTransferFlags } from '@/lib/sync/transfers'
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

it('flags the categories that are not spending, and only those', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const payment = await insertTransaction(db, accountId, {
    description: 'PAGAMENTO FATURA',
    amountCents: -177_174_79,
    pluggyCategory: 'Credit card payment',
  })
  const groceries = await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    pluggyCategory: 'Groceries',
  })

  const { flagged } = await refreshTransferFlags(db, householdId)

  expect(flagged).toBe(1)
  const rows = await listTransactions(db, householdId, { includeTransfers: true })
  expect(rows.find((r) => r.id === payment)!.isTransfer).toBe(true)
  expect(rows.find((r) => r.id === groceries)!.isTransfer).toBe(false)
})

it('flags a hand-categorized row too, which recategorize could never do', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const id = await insertTransaction(db, accountId, {
    description: 'PAGAMENTO FATURA',
    pluggyCategory: 'Credit card payment',
  })
  // recategorize excludes MANUAL rows in its WHERE clause. Whether a row is
  // an invoice payment has nothing to do with who set its category, which is
  // exactly why transfer detection is a separate pass.
  await db
    .update(transactions)
    .set({ categorySource: 'MANUAL' })
    .where(eq(transactions.id, id))

  await refreshTransferFlags(db, householdId)

  const rows = await listTransactions(db, householdId, { includeTransfers: true })
  expect(rows.find((r) => r.id === id)!.isTransfer).toBe(true)
})

it('hides transfers from the default listing', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, {
    description: 'PAGAMENTO FATURA',
    pluggyCategory: 'Credit card payment',
  })
  await insertTransaction(db, accountId, { description: 'ZAFFARI', pluggyCategory: 'Groceries' })
  await refreshTransferFlags(db, householdId)

  const visible = await listTransactions(db, householdId)
  const all = await listTransactions(db, householdId, { includeTransfers: true })

  expect(visible).toHaveLength(1)
  expect(visible[0].description).toBe('ZAFFARI')
  expect(all).toHaveLength(2)
})

it('is idempotent, and unflags a row whose category stopped being a transfer', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const id = await insertTransaction(db, accountId, {
    description: 'AJUSTE',
    pluggyCategory: 'Transfers',
  })
  await refreshTransferFlags(db, householdId)
  expect((await refreshTransferFlags(db, householdId)).flagged).toBe(0)

  await db
    .update(transactions)
    .set({ pluggyCategory: 'Groceries' })
    .where(eq(transactions.id, id))
  const { flagged } = await refreshTransferFlags(db, householdId)

  expect(flagged).toBe(1)
  const rows = await listTransactions(db, householdId)
  expect(rows.find((r) => r.id === id)!.isTransfer).toBe(false)
})

it('scopes to the household it was asked about', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, {
    description: 'PAGAMENTO FATURA',
    pluggyCategory: 'Credit card payment',
  })
  const { householdId: otherId } = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })

  const { flagged } = await refreshTransferFlags(db, otherId)

  expect(flagged).toBe(0)
  // The other household's run must not touch this one's row at all: it
  // stays unflagged (never processed) and therefore still visible in the
  // default listing, which is what proves the two households didn't share
  // an unscoped update -- mirrors the equivalent scoping assertion in
  // tests/recategorize.test.ts, which also checks the untouched row rather
  // than an empty result.
  const rows = await listTransactions(db, householdId)
  expect(rows).toHaveLength(1)
  expect(rows[0].isTransfer).toBe(false)
})

// NOT a test of the mapper: insertTransaction parses the descriptor itself,
// so this covers the columns and the read path only. mapTransaction's own
// assignments are asserted in tests/pluggy-v2.test.ts.
it('stores and reads back the instalment columns on a transaction row', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const id = await insertTransaction(db, accountId, { description: 'AUTO MECANICA BOA 03/10' })

  const rows = await listTransactions(db, householdId)

  expect(rows.find((r) => r.id === id)).toMatchObject({
    installmentNumber: 3,
    installmentTotal: 10,
  })
})
