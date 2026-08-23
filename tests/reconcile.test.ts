import { beforeEach, expect, it } from 'vitest'
import { GET } from '@/app/api/cron/reconcile/route'
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

function cronRequest(authorization: string | null) {
  return new Request('https://app.test/api/cron/reconcile', {
    method: 'GET',
    headers: authorization ? { authorization } : {},
  })
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

it('keeps reconciling connections that come after a failed one', async () => {
  // The broken connection is created FIRST and the healthy one SECOND, so
  // with reconcileAll's deterministic createdAt ordering the broken one is
  // processed first. This proves the loop keeps going past a failure --
  // a `catch { failed.push(id); break }` regression would leave the
  // healthy connection (which comes after) unsynced.
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  await db.insert(connections).values({
    householdId,
    ownerUserId: userId,
    pluggyItemId: 'item-broken',
    institution: 'Broken Bank',
    status: 'UPDATED',
  })
  await attachConnection(db, pluggy(), {
    householdId,
    ownerUserId: userId,
    itemId: 'item-nubank-1',
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

it('rejects a cron request with a missing secret and does no work', async () => {
  const { db, householdId } = await seed()

  const response = await GET(cronRequest(null))

  expect(response.status).toBe(401)
  expect(await listTransactions(db, householdId)).toHaveLength(0)
})

it('rejects a cron request with a wrong secret and does no work', async () => {
  const { db, householdId } = await seed()

  const response = await GET(cronRequest('Bearer wrong-secret-value-1234'))

  expect(response.status).toBe(401)
  expect(await listTransactions(db, householdId)).toHaveLength(0)
})

it('runs the real reconcile through the route on a valid secret', async () => {
  const { db, householdId } = await seed()

  const response = await GET(cronRequest('Bearer cron-secret-value-1234'))
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.succeeded).toHaveLength(1)
  expect(body.failed).toHaveLength(0)
  expect(await listTransactions(db, householdId)).not.toHaveLength(0)
})

it('reports 207 through the route when some connections fail and some succeed', async () => {
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

  const response = await GET(cronRequest('Bearer cron-secret-value-1234'))
  const body = await response.json()

  // A partial reconcile must never report a clean 200: the run is not healthy,
  // and the household's totals are missing a card.
  expect(response.status).toBe(207)
  expect(body.succeeded).toHaveLength(1)
  expect(body.failed).toHaveLength(1)
  expect(await listTransactions(db, householdId)).not.toHaveLength(0)
})

it('reports 500 through the route when every connection fails', async () => {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
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

  const response = await GET(cronRequest('Bearer cron-secret-value-1234'))
  const body = await response.json()

  expect(response.status).toBe(500)
  expect(body.succeeded).toHaveLength(0)
  expect(body.failed).toHaveLength(1)
})
