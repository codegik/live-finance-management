import { beforeEach, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

const session = vi.hoisted(() => ({ current: { householdId: '', id: '' } }))
vi.mock('@/lib/auth/session', () => ({
  requireSession: async () => session.current,
  toSignInOrThrow: () => {
    throw new Error('UNAUTHENTICATED')
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { removeConnectionAction } = await import('@/app/(app)/settings/connections/actions')
const { UNKNOWN_CONNECTION_ERROR } = await import('@/app/(app)/settings/connections/state')

const EMPTY = { error: null, message: null }

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

async function seedConnection(institution: string, householdId: string, userId: string) {
  const db = testDb()
  const [row] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution,
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, row.id)
  await insertTransaction(db, accountId, { description: `${institution} ZAFFARI` })
  return row.id
}

it('removes one connection and leaves the other household connection intact', async () => {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  session.current = { householdId, id: userId }
  const doomed = await seedConnection('Nubank', householdId, userId)
  await seedConnection('Itau', householdId, userId)

  const state = await removeConnectionAction(EMPTY, form({ connectionId: doomed }))

  expect(state.error).toBeNull()
  const rows = await listTransactions(db, householdId, { includeExcluded: true })
  expect(rows).toHaveLength(1)
  expect(rows[0].institution).toBe('Itau')
})

it('refuses to remove another household connection', async () => {
  const db = testDb()
  const mine = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const theirs = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })
  session.current = { householdId: mine.householdId, id: mine.userId }
  const target = await seedConnection('Itau', theirs.householdId, theirs.userId)

  const state = await removeConnectionAction(EMPTY, form({ connectionId: target }))

  expect(state.error).toBe(UNKNOWN_CONNECTION_ERROR)
  const survivors = await listTransactions(db, theirs.householdId, { includeExcluded: true })
  expect(survivors).toHaveLength(1)
})
