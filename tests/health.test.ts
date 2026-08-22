import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { hashPassword } from '@/lib/auth/password'
import { getHouseholdHealth } from '@/lib/db/health'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { syncConnection } from '@/lib/sync/transactions'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'

const server = startPluggyServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
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
  const { connectionId } = await attachConnection(db, pluggy(), {
    householdId,
    ownerUserId: userId,
    itemId: 'item-nubank-1',
  })
  return { db, householdId, connectionId }
}

it('reports a freshly synced household as healthy', async () => {
  const { db, householdId, connectionId } = await seed()
  await syncConnection(db, pluggy(), connectionId)

  const health = await getHouseholdHealth(db, householdId)

  expect(health.allFresh).toBe(true)
  expect(health.stale).toHaveLength(0)
})

it('flags a connection whose bank needs re-authentication', async () => {
  const { db, householdId, connectionId } = await seed()

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/items/item-nubank-1', () =>
      HttpResponse.json({
        id: 'item-nubank-1',
        status: 'LOGIN_ERROR',
        connector: { id: 212, name: 'Nubank' },
        lastUpdatedAt: '2026-08-22T09:00:00.000Z',
      }),
    ),
  )
  await syncConnection(db, pluggy(), connectionId)

  const health = await getHouseholdHealth(db, householdId)

  expect(health.allFresh).toBe(false)
  expect(health.stale).toEqual([
    { connectionId, institution: 'Nubank', reason: 'NEEDS_REAUTH' },
  ])
})

it('flags a connection waiting on user input as needing re-authentication', async () => {
  const { db, householdId, connectionId } = await seed()

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/items/item-nubank-1', () =>
      HttpResponse.json({
        id: 'item-nubank-1',
        status: 'WAITING_USER_INPUT',
        connector: { id: 212, name: 'Nubank' },
        lastUpdatedAt: '2026-08-22T09:00:00.000Z',
      }),
    ),
  )
  await syncConnection(db, pluggy(), connectionId)

  const health = await getHouseholdHealth(db, householdId)

  expect(health.allFresh).toBe(false)
  expect(health.stale).toEqual([
    { connectionId, institution: 'Nubank', reason: 'NEEDS_REAUTH' },
  ])
})

it('flags a connection Pluggy reports as OUTDATED even when it just synced', async () => {
  const { db, householdId, connectionId } = await seed()

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/items/item-nubank-1', () =>
      HttpResponse.json({
        id: 'item-nubank-1',
        status: 'OUTDATED',
        connector: { id: 212, name: 'Nubank' },
        lastUpdatedAt: '2026-08-22T09:00:00.000Z',
      }),
    ),
  )
  await syncConnection(db, pluggy(), connectionId)

  // lastSyncedAt was just stamped seconds ago -- well inside the freshness
  // window -- so only the OUTDATED status itself can be driving this.
  const health = await getHouseholdHealth(db, householdId)

  expect(health.allFresh).toBe(false)
  expect(health.stale).toEqual([
    { connectionId, institution: 'Nubank', reason: 'NOT_UPDATING' },
  ])
})

it('flags a connection that has not synced within the freshness window', async () => {
  const { db, householdId, connectionId } = await seed()
  await syncConnection(db, pluggy(), connectionId)

  await db
    .update(connections)
    .set({ lastSyncedAt: new Date('2026-08-18T00:00:00.000Z') })
    .where(eq(connections.id, connectionId))

  const health = await getHouseholdHealth(db, householdId, {
    now: new Date('2026-08-22T12:00:00.000Z'),
  })

  expect(health.allFresh).toBe(false)
  expect(health.stale[0].reason).toBe('NOT_UPDATING')
})

it('flags a connection that has never synced', async () => {
  const { db, householdId } = await seed()

  const health = await getHouseholdHealth(db, householdId)

  expect(health.allFresh).toBe(false)
  expect(health.stale[0].reason).toBe('NOT_UPDATING')
})

it('does not leak a stale connection from another household', async () => {
  // The seeded household's connection is never synced, so it is stale --
  // but we only ever ask about a different, unrelated household below.
  await seed()

  const db = testDb()
  const other = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })

  const health = await getHouseholdHealth(db, other.householdId)

  expect(health.allFresh).toBe(true)
  expect(health.stale).toHaveLength(0)
})
