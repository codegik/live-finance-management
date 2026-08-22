import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { reconcileAll } from '@/lib/sync/reconcile'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'

const server = startPluggyServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
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

async function seed() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  await attachConnection(db, pluggy(), {
    householdId,
    ownerUserId: userId,
    itemId: 'item-nubank-1',
  })
  return { db, householdId, userId }
}

it('syncs every connection and records when it last succeeded', async () => {
  const { db, householdId } = await seed()

  const result = await reconcileAll(db, pluggy())

  expect(result.failed).toHaveLength(0)
  expect(result.succeeded).toHaveLength(1)
  expect(await listTransactions(db, householdId)).not.toHaveLength(0)

  const [connection] = await db.select().from(connections)
  expect(connection.lastSyncedAt).not.toBeNull()
})

it('keeps reconciling other connections when one fails', async () => {
  const { db, householdId, userId } = await seed()
  await db.insert(connections).values({
    householdId,
    ownerUserId: userId,
    pluggyItemId: 'item-broken',
    institution: 'Broken Bank',
    status: 'UPDATED',
  })

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/items/item-broken', () =>
      HttpResponse.json({ error: 'boom' }, { status: 500 }),
    ),
  )

  const result = await reconcileAll(db, pluggy())

  expect(result.failed).toHaveLength(1)
  expect(result.succeeded).toHaveLength(1)
  expect(await listTransactions(db, householdId)).not.toHaveLength(0)
})

it('leaves existing data in place when a connection fails', async () => {
  const { db, householdId } = await seed()
  await reconcileAll(db, pluggy())
  const before = await listTransactions(db, householdId)

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/transactions', () =>
      HttpResponse.json({ error: 'boom' }, { status: 500 }),
    ),
  )
  await reconcileAll(db, pluggy())

  expect(await listTransactions(db, householdId)).toHaveLength(before.length)
})
