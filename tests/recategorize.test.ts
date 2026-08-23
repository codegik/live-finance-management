import { eq } from 'drizzle-orm'
import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { transactions } from '@/lib/db/schema'
import { listTransactions, setTransactionCategory } from '@/lib/db/transactions'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { recategorize } from '@/lib/sync/categorize'
import { syncConnection } from '@/lib/sync/transactions'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'
import { insertTransaction, seedAccount } from './helpers/transactions'

startPluggyServer()

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

function pluggy() {
  return createPluggyClient({
    apiUrl: 'https://api.pluggy.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  })
}

async function seedSynced() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const { connectionId } = await attachConnection(db, pluggy(), {
    householdId,
    ownerUserId: userId,
    itemId: 'item-nubank-1',
  })
  await syncConnection(db, pluggy(), connectionId)
  return { db, householdId, connectionId }
}

async function categoryNamed(householdId: string, name: string): Promise<string> {
  const all = await listCategories(testDb(), householdId)
  return all.find((c) => c.name === name)!.id
}

it('categorizes through Pluggy during the sync itself', async () => {
  const { db, householdId } = await seedSynced()

  const rows = await listTransactions(db, householdId)
  const zaffari = rows.find((r) => r.pluggyTransactionId === 'tx-1')!

  expect(zaffari.categoryId).toBe(await categoryNamed(householdId, 'Supermercado'))
  expect(zaffari.categorySource).toBe('PLUGGY')
})

it('leaves an unmapped Pluggy category uncategorized', async () => {
  const { db, householdId } = await seedSynced()

  const rows = await listTransactions(db, householdId)
  const fee = rows.find((r) => r.pluggyTransactionId === 'tx-bank-1')!

  expect(fee.categoryId).toBeNull()
  expect(fee.categorySource).toBeNull()
})

// Spec case 4.
it('never overwrites a hand-set category on a later sync', async () => {
  const { db, householdId, connectionId } = await seedSynced()
  const leisure = await categoryNamed(householdId, 'Lazer')
  const before = await listTransactions(db, householdId)
  const zaffari = before.find((r) => r.pluggyTransactionId === 'tx-1')!

  await setTransactionCategory(db, householdId, zaffari.id, leisure)
  // The same payload arrives again, still saying 'Supermarkets'.
  await syncConnection(db, pluggy(), connectionId)

  const after = await listTransactions(db, householdId)
  const stillManual = after.find((r) => r.pluggyTransactionId === 'tx-1')!
  expect(stillManual.categoryId).toBe(leisure)
  expect(stillManual.categorySource).toBe('MANUAL')
})

it('is idempotent: a second run over the same rows changes nothing', async () => {
  const { db, householdId } = await seedSynced()

  // The sync already categorized everything, so even the first run is a
  // no-op. Both must be, or the nightly reconcile would rewrite every row
  // every night.
  expect((await recategorize(db, { householdId })).changed).toBe(0)
  expect((await recategorize(db, { householdId })).changed).toBe(0)
})

it('recomputes a stale merchant on a household-wide run', async () => {
  const { db, householdId, connectionId } = await seedSynced()
  const accountId = await seedAccount(db, connectionId, { name: 'Second card' })
  const id = await insertTransaction(db, accountId, { description: 'PADARIA CENTRAL' })
  // Simulate a row written before the normalizer knew about asterisk tails.
  await db
    .update(transactions)
    .set({ merchantNormalized: 'PADARIA CENTRAL *991' })
    .where(eq(transactions.id, id))

  await recategorize(db, { householdId })

  const rows = await listTransactions(db, householdId)
  expect(rows.find((r) => r.id === id)!.merchantNormalized).toBe('PADARIA CENTRAL')
})

it('scopes a run to the household it was asked about', async () => {
  const { db, householdId } = await seedSynced()
  const { householdId: otherId } = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })

  const result = await recategorize(db, { householdId: otherId })

  expect(result.changed).toBe(0)
  const rows = await listTransactions(db, householdId)
  expect(rows.find((r) => r.pluggyTransactionId === 'tx-1')!.categoryId).not.toBeNull()
})
