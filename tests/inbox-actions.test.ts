import { beforeEach, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { listRules } from '@/lib/db/rules'
import { connections } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

// The action reads the signed-in household from the session; the database
// work underneath it is real.
const session = vi.hoisted(() => ({ current: { householdId: '', userId: '' } }))
vi.mock('@/lib/auth/session', () => ({
  requireSession: async () => session.current,
  toSignInOrThrow: () => {
    throw new Error('UNAUTHENTICATED')
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { assignGroupAction } = await import('@/app/(app)/inbox/actions')
const { ASSIGNED_MESSAGE, DUPLICATE_RULE_ERROR, EMPTY_PATTERN_ERROR, MISSING_FIELD_ERROR } =
  await import('@/app/(app)/inbox/state')

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

async function seedHousehold() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  session.current = { householdId, userId }
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

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

it('writes a rule and marks the group RULE when the toggle is on', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'ZAFFARI' })
  const [supermarket] = await listCategories(db, householdId)

  const result = await assignGroupAction(
    { error: null, message: null },
    form({
      merchant: 'ZAFFARI',
      categoryId: supermarket.id,
      createRule: 'on',
      pattern: 'ZAFFARI',
      matchType: 'EXACT',
    }),
  )

  expect(result.error).toBeNull()
  expect(result.message).toContain(ASSIGNED_MESSAGE)
  expect(await listRules(db, householdId)).toHaveLength(1)
  const rows = await listTransactions(db, householdId)
  expect(rows[0].categorySource).toBe('RULE')
})

it('writes MANUAL and no rule when the toggle is off', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'ZAFFARI' })
  const [supermarket] = await listCategories(db, householdId)

  await assignGroupAction(
    { error: null, message: null },
    form({ merchant: 'ZAFFARI', categoryId: supermarket.id }),
  )

  expect(await listRules(db, householdId)).toEqual([])
  const rows = await listTransactions(db, householdId)
  expect(rows[0].categorySource).toBe('MANUAL')
})

it('lets the pattern be shortened to a CONTAINS rule that covers both branches', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'ZAFFARI PORTO ALEG *0421' })
  await insertTransaction(db, accountId, { description: 'ZAFFARI CENTRO' })
  const [supermarket] = await listCategories(db, householdId)

  await assignGroupAction(
    { error: null, message: null },
    form({
      merchant: 'ZAFFARI PORTO ALEG',
      categoryId: supermarket.id,
      createRule: 'on',
      pattern: 'ZAFFARI',
      matchType: 'CONTAINS',
    }),
  )

  const rows = await listTransactions(db, householdId)
  expect(rows.every((r) => r.categoryId === supermarket.id)).toBe(true)
})

it('refuses an assignment with no category chosen', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'ZAFFARI' })

  const result = await assignGroupAction(
    { error: null, message: null },
    form({ merchant: 'ZAFFARI', categoryId: '' }),
  )

  expect(result.error).toBe(MISSING_FIELD_ERROR)
  const rows = await listTransactions(db, householdId)
  expect(rows[0].categoryId).toBeNull()
})

it('reports an empty pattern rather than throwing, and leaves the group untouched', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'ZAFFARI' })
  const [supermarket] = await listCategories(db, householdId)

  const result = await assignGroupAction(
    { error: null, message: null },
    form({
      merchant: 'ZAFFARI',
      categoryId: supermarket.id,
      createRule: 'on',
      pattern: '***',
      matchType: 'EXACT',
    }),
  )

  expect(result.error).toBe(EMPTY_PATTERN_ERROR)
  expect(await listRules(db, householdId)).toEqual([])
  const rows = await listTransactions(db, householdId)
  expect(rows[0].categoryId).toBeNull()
})

it('reports a duplicate rule as a friendly error instead of a 500', async () => {
  // /inbox renders one independent form per merchant group, and the design's
  // headline workflow is shortening two branch groups to the same CONTAINS
  // pattern. Submitting the second before the revalidated payload lands hits
  // merchant_rule_unique, which postgres raises as 23505.
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'ZAFFARI PORTO ALEG *0421' })
  await insertTransaction(db, accountId, { description: 'ZAFFARI CENTRO' })
  const [supermarket] = await listCategories(db, householdId)

  const first = await assignGroupAction(
    { error: null, message: null },
    form({
      merchant: 'ZAFFARI PORTO ALEG',
      categoryId: supermarket.id,
      createRule: 'on',
      pattern: 'ZAFFARI',
      matchType: 'CONTAINS',
    }),
  )
  expect(first.error).toBeNull()

  const second = await assignGroupAction(
    { error: null, message: null },
    form({
      merchant: 'ZAFFARI CENTRO',
      categoryId: supermarket.id,
      createRule: 'on',
      pattern: 'ZAFFARI',
      matchType: 'CONTAINS',
    }),
  )

  expect(second.error).toBe(DUPLICATE_RULE_ERROR)
  expect(await listRules(db, householdId)).toHaveLength(1)
})
