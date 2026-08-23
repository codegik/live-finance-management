import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { createRule, deleteRule, listRules } from '@/lib/db/rules'
import { listTransactions, setTransactionCategory } from '@/lib/db/transactions'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'
import { connections } from '@/lib/db/schema'

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

async function categoryNamed(householdId: string, name: string): Promise<string> {
  const all = await listCategories(testDb(), householdId)
  return all.find((c) => c.name === name)!.id
}

it('backfills past transactions the moment the rule is created', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'ZAFFARI' })
  await insertTransaction(db, accountId, { description: 'ZAFFARI' })
  const supermarket = await categoryNamed(householdId, 'Supermercado')

  const { changed } = await createRule(db, householdId, {
    matchType: 'EXACT',
    pattern: 'ZAFFARI',
    categoryId: supermarket,
  })

  expect(changed).toBe(2)
  const rows = await listTransactions(db, householdId)
  expect(rows.every((r) => r.categoryId === supermarket)).toBe(true)
  expect(rows.every((r) => r.categorySource === 'RULE')).toBe(true)
})

// Spec case 2: one CONTAINS rule covers branch variants, retroactively.
it('lets a CONTAINS rule reach every branch variant of a merchant', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'ZAFFARI PORTO ALEG *0421' })
  await insertTransaction(db, accountId, { description: 'ZAFFARI CENTRO PARC 03/12' })
  const supermarket = await categoryNamed(householdId, 'Supermercado')

  const { changed } = await createRule(db, householdId, {
    matchType: 'CONTAINS',
    pattern: 'ZAFFARI',
    categoryId: supermarket,
  })

  expect(changed).toBe(2)
})

it('leaves a hand-set category alone when a rule would have claimed it', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const manualId = await insertTransaction(db, accountId, { description: 'ZAFFARI' })
  await insertTransaction(db, accountId, { description: 'ZAFFARI' })
  const leisure = await categoryNamed(householdId, 'Lazer')
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await setTransactionCategory(db, householdId, manualId, leisure)

  const { changed } = await createRule(db, householdId, {
    matchType: 'EXACT',
    pattern: 'ZAFFARI',
    categoryId: supermarket,
  })

  expect(changed).toBe(1)
  const rows = await listTransactions(db, householdId)
  expect(rows.find((r) => r.id === manualId)!.categoryId).toBe(leisure)
  expect(rows.find((r) => r.id === manualId)!.categorySource).toBe('MANUAL')
})

it('returns transactions to the inbox when the rule is deleted', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'ZAFFARI' })
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  const { ruleId } = await createRule(db, householdId, {
    matchType: 'EXACT',
    pattern: 'ZAFFARI',
    categoryId: supermarket,
  })

  const { changed } = await deleteRule(db, householdId, ruleId)

  expect(changed).toBe(1)
  const rows = await listTransactions(db, householdId)
  expect(rows[0].categoryId).toBeNull()
  expect(rows[0].categorySource).toBeNull()
})

it('rejects a rule pointing at a category that does not exist, leaving no row', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'ZAFFARI' })

  // A category id from no household at all: the insert violates the foreign
  // key. This proves the insert itself is rejected -- it fires before
  // recategorize is ever reached, so it does NOT prove insert-and-backfill
  // atomicity. See tests/rules-atomicity.test.ts for that property, which
  // needs fault injection past a successful insert.
  await expect(
    createRule(db, householdId, {
      matchType: 'EXACT',
      pattern: 'ZAFFARI',
      categoryId: '44444444-4444-4444-4444-444444444444',
    }),
  ).rejects.toThrow()

  expect(await listRules(db, householdId)).toEqual([])
})

it('rejects a pattern that normalizes to nothing, writing no rule', async () => {
  const { db, householdId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')

  // '***' has no alphanumeric characters, so normalizeMerchant reduces it to
  // null -- createRule must refuse it rather than store an empty pattern
  // that would match nothing (EXACT) or everything (CONTAINS).
  await expect(
    createRule(db, householdId, { matchType: 'EXACT', pattern: '***', categoryId: supermarket }),
  ).rejects.toThrow('EMPTY_PATTERN')

  expect(await listRules(db, householdId)).toEqual([])
})

it('gives an EXACT rule a lower priority number than a hand-written CONTAINS rule', async () => {
  const { db, householdId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  const leisure = await categoryNamed(householdId, 'Lazer')

  await createRule(db, householdId, { matchType: 'EXACT', pattern: 'ZAFFARI', categoryId: supermarket })
  await createRule(db, householdId, { matchType: 'CONTAINS', pattern: 'ZAF', categoryId: leisure })

  const rules = await listRules(db, householdId)
  const exact = rules.find((r) => r.matchType === 'EXACT')!
  const contains = rules.find((r) => r.matchType === 'CONTAINS')!
  expect(exact.priority).toBeLessThan(contains.priority)
  expect(exact.categoryName).toBe('Supermercado')
})

it('scopes rule listing and deletion to the household', async () => {
  const { db, householdId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  const { ruleId } = await createRule(db, householdId, {
    matchType: 'EXACT',
    pattern: 'ZAFFARI',
    categoryId: supermarket,
  })
  const { householdId: otherId } = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })

  await deleteRule(db, otherId, ruleId)

  expect(await listRules(db, householdId)).toHaveLength(1)
  expect(await listRules(db, otherId)).toEqual([])
})
