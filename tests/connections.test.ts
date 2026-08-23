import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listAccounts, listConnections } from '@/lib/db/connections'
import { createHousehold } from '@/lib/db/households'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { resetDb, testDb } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'

const server = startPluggyServer()

beforeEach(resetDb)

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
  return { db, householdId, userId }
}

async function seedOther() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })
  return { db, householdId, userId }
}

it('stores the connection and its accounts, attributed to the connecting user', async () => {
  const { db, householdId, userId } = await seed()

  await attachConnection(db, pluggy(), {
    householdId,
    ownerUserId: userId,
    itemId: 'item-nubank-1',
  })

  const connections = await listConnections(db, householdId)
  expect(connections).toHaveLength(1)
  expect(connections[0].institution).toBe('Nubank')
  expect(connections[0].ownerUserId).toBe(userId)
  expect(connections[0].status).toBe('UPDATED')

  const accounts = await listAccounts(db, householdId)
  expect(accounts).toHaveLength(2)

  const credit = accounts.find((a) => a.type === 'CREDIT')!
  expect(credit.last4).toBe('1234')
  expect(credit.dueDay).toBe(10)
})

it('is idempotent when the same item is attached twice', async () => {
  const { db, householdId, userId } = await seed()
  const input = { householdId, ownerUserId: userId, itemId: 'item-nubank-1' }

  const first = await attachConnection(db, pluggy(), input)
  const second = await attachConnection(db, pluggy(), input)

  expect(second.connectionId).toBe(first.connectionId)
  expect(await listConnections(db, householdId)).toHaveLength(1)
  expect(await listAccounts(db, householdId)).toHaveLength(2)
})

it('does not leak accounts across households', async () => {
  const { db, householdId, userId } = await seed()
  await attachConnection(db, pluggy(), { householdId, ownerUserId: userId, itemId: 'item-nubank-1' })

  const other = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })

  expect(await listAccounts(db, other.householdId)).toHaveLength(0)
})

it('refuses to attach an item that already belongs to another household', async () => {
  // pluggy_item_id is globally unique with no household component, and the
  // itemId arrives from a request body. Without a household check, household
  // B could post household A's itemId and overwrite A's connection row --
  // the only write in the branch that could cross the boundary.
  const { db, householdId: ownerHousehold, userId: ownerUser } = await seed()
  await attachConnection(db, pluggy(), {
    householdId: ownerHousehold,
    ownerUserId: ownerUser,
    itemId: 'item-nubank-1',
  })

  const { householdId: attackerHousehold, userId: attackerUser } = await seedOther()

  // Different institution name on the hijack attempt, so "A's row is
  // unchanged" is a claim with teeth rather than a coincidence of fixtures.
  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/items/item-nubank-1', () =>
      HttpResponse.json({
        id: 'item-nubank-1',
        status: 'LOGIN_ERROR',
        connector: { id: 999, name: 'Hijacked Bank' },
        lastUpdatedAt: null,
      }),
    ),
  )

  await expect(
    attachConnection(db, pluggy(), {
      householdId: attackerHousehold,
      ownerUserId: attackerUser,
      itemId: 'item-nubank-1',
    }),
  ).rejects.toThrow('CONNECTION_OWNED_BY_ANOTHER_HOUSEHOLD')

  const attackerConnections = await listConnections(db, attackerHousehold)
  expect(attackerConnections).toHaveLength(0)
  expect(await listAccounts(db, attackerHousehold)).toHaveLength(0)

  const [owned] = await listConnections(db, ownerHousehold)
  expect(owned.institution).toBe('Nubank')
  expect(owned.status).toBe('UPDATED')
  expect(owned.ownerUserId).toBe(ownerUser)
})
