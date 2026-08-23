import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
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
    owner: {
      email: `inacio-${crypto.randomUUID()}@example.com`,
      name: 'Inacio',
      passwordHash: await hashPassword('pw'),
    },
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
