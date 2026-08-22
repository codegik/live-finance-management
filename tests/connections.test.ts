import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listAccounts, listConnections } from '@/lib/db/connections'
import { createHousehold } from '@/lib/db/households'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { resetDb, testDb } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'

const server = startPluggyServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
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
