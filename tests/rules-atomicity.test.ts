import { beforeEach, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

// This file exists separately from tests/rules.test.ts because the mock
// below is module-scoped: every test in this file gets a recategorize that
// always throws, which would break the other tests that need the real
// implementation. Vitest isolates modules per test file (pool: 'forks',
// isolate: true), so the mock does not leak into other files.
//
// Everything except recategorize is real Postgres: household, connection,
// account, transaction and the rollback itself. Only the module boundary is
// faked, to force a failure *after* the rule insert has already succeeded --
// the FK-violation test in tests/rules.test.ts fails before that point, so
// it cannot prove insert-and-backfill are atomic. This test can.
vi.mock('@/lib/sync/categorize', () => ({
  recategorize: vi.fn(async () => {
    throw new Error('BACKFILL_FAILED')
  }),
}))

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

it('rolls back a successfully inserted rule when its backfill fails', async () => {
  const { createRule, listRules } = await import('@/lib/db/rules')
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
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution: 'Nubank',
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, connection.id)
  await insertTransaction(db, accountId, { description: 'ZAFFARI' })
  const categories = await listCategories(db, householdId)
  const categoryId = categories[0].id

  // Every input here is valid -- the insert alone would succeed. Only the
  // mocked recategorize call after it fails, so this exercises the
  // transaction wrapper itself rather than an upstream validation error.
  await expect(
    createRule(db, householdId, { matchType: 'EXACT', pattern: 'ZAFFARI', categoryId }),
  ).rejects.toThrow('BACKFILL_FAILED')

  expect(await listRules(db, householdId)).toEqual([])
})
