import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listConnectionDetails } from '@/lib/db/connections'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

const NOW = new Date('2026-08-23T12:00:00Z')

it('reports each connection with its owner, staleness and accounts', async () => {
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
      pluggyItemId: 'item-nubank-1',
      institution: 'Nubank',
      status: 'LOGIN_ERROR',
      lastSyncedAt: NOW,
    })
    .returning({ id: connections.id })
  await seedAccount(db, connection.id, { name: 'Cartao', type: 'CREDIT' })
  await seedAccount(db, connection.id, { name: 'Conta', type: 'BANK' })

  const [detail] = await listConnectionDetails(db, householdId, { now: NOW })

  expect(detail.institution).toBe('Nubank')
  expect(detail.ownerName).toBe('Inacio')
  // A LOGIN_ERROR is stale however recently it synced -- that is the whole
  // point of the reason, and the screen has to offer the repair.
  expect(detail.stale).toBe('NEEDS_REAUTH')
  expect(detail.accounts.map((a) => a.name).sort()).toEqual(['Cartao', 'Conta'])
})

it('shows nothing from another household', async () => {
  const db = testDb()
  const mine = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const theirs = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })
  await db.insert(connections).values({
    householdId: theirs.householdId,
    ownerUserId: theirs.userId,
    pluggyItemId: 'item-theirs-1',
    institution: 'Itau',
    status: 'UPDATED',
    lastSyncedAt: NOW,
  })

  expect(await listConnectionDetails(db, mine.householdId, { now: NOW })).toEqual([])
})
