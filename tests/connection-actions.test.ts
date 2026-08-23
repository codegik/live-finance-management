import { beforeEach, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { listAccounts, listConnectionDetails } from '@/lib/db/connections'
import { accounts, connections } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { createPluggyClient } from '@/lib/pluggy/client'
import { refreshAccounts } from '@/lib/sync/accounts'
import { attachConnection } from '@/lib/sync/connect'
import { eq } from 'drizzle-orm'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'
import { insertTransaction, seedAccount } from './helpers/transactions'

const server = startPluggyServer()

function pluggy() {
  return createPluggyClient({
    apiUrl: 'https://api.pluggy.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  })
}

const session = vi.hoisted(() => ({ current: { householdId: '', id: '' } }))
vi.mock('@/lib/auth/session', () => ({
  requireSession: async () => session.current,
  toSignInOrThrow: () => {
    throw new Error('UNAUTHENTICATED')
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { removeConnectionAction, saveAccountDaysAction } = await import(
  '@/app/(app)/settings/connections/actions'
)
const { INVALID_DAY_ERROR, UNKNOWN_ACCOUNT_ERROR, UNKNOWN_CONNECTION_ERROR } = await import(
  '@/app/(app)/settings/connections/state'
)

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

it('keeps an overridden due day across a real refreshAccounts sync that rewrites the Pluggy value', async () => {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  session.current = { householdId, id: userId }
  // attachConnection runs refreshAccounts itself, against the Pluggy fake:
  // the fixture's acc-credit-1 reports balanceDueDate 2026-09-10, so the
  // credit account is seeded with dueDay 10 exactly like a real connect.
  const { connectionId } = await attachConnection(db, pluggy(), {
    householdId,
    ownerUserId: userId,
    itemId: 'item-nubank-1',
  })
  const [creditAccount] = (await listAccounts(db, householdId)).filter((a) => a.type === 'CREDIT')
  const accountId = creditAccount.id

  const state = await saveAccountDaysAction(EMPTY, form({ accountId, dueDay: '15', closingDay: '3' }))
  expect(state.error).toBeNull()

  // The real sync path, not a hand-rolled update: this is what would catch
  // refreshAccounts itself accidentally writing the override columns. The
  // fixture reports the same dueDay (10) again, so the only way this
  // assertion can pass is if refreshAccounts never touches the override
  // columns and the coalesce in listConnectionDetails resolves correctly.
  await refreshAccounts(db, pluggy(), connectionId, 'item-nubank-1')

  const [detail] = await listConnectionDetails(db, householdId)
  const account = detail.accounts.find((a) => a.id === accountId)!
  expect(account.dueDay).toBe(15)
  expect(account.closingDay).toBe(3)
  expect(account.pluggyDueDay).toBe(10)
})

it('rejects a day outside the month', async () => {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  session.current = { householdId, id: userId }
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: 'item-nubank-2',
      institution: 'Nubank',
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, connection.id)

  const state = await saveAccountDaysAction(EMPTY, form({ accountId, dueDay: '32', closingDay: '' }))

  expect(state.error).toBe(INVALID_DAY_ERROR)
})

it('refuses to set days on another household account', async () => {
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
  const [connection] = await db
    .insert(connections)
    .values({
      householdId: theirs.householdId,
      ownerUserId: theirs.userId,
      pluggyItemId: 'item-theirs-2',
      institution: 'Itau',
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, connection.id)

  const state = await saveAccountDaysAction(EMPTY, form({ accountId, dueDay: '15', closingDay: '' }))

  expect(state.error).toBe(UNKNOWN_ACCOUNT_ERROR)
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId))
  expect(row.dueDayOverride).toBeNull()
  expect(row.closingDayOverride).toBeNull()
})

// A hand-edited form field or stale client can send a connectionId /
// accountId that is not a UUID at all. Postgres rejects that shape with
// 22P02 ("invalid input syntax for type uuid") inside eq(<uuid column>, ...)
// -- a thrown error, not an empty result -- unless it is caught before the
// db layer. These must resolve to the same "doesn't exist" state as a
// well-formed but unknown id, not throw.
it('treats a non-UUID connectionId as unknown rather than throwing', async () => {
  const { householdId, userId } = await createHousehold(testDb(), {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  session.current = { householdId, id: userId }

  const state = await removeConnectionAction(EMPTY, form({ connectionId: 'not-a-uuid' }))

  expect(state.error).toBe(UNKNOWN_CONNECTION_ERROR)
})

it('treats a non-UUID accountId as unknown rather than throwing', async () => {
  const { householdId, userId } = await createHousehold(testDb(), {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  session.current = { householdId, id: userId }

  const state = await saveAccountDaysAction(
    EMPTY,
    form({ accountId: 'not-a-uuid', dueDay: '15', closingDay: '' }),
  )

  expect(state.error).toBe(UNKNOWN_ACCOUNT_ERROR)
})
