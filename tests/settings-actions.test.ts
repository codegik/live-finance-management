import { beforeEach, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { createRule, listRules } from '@/lib/db/rules'
import { connections } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

const session = vi.hoisted(() => ({ current: { householdId: '', userId: '' } }))
vi.mock('@/lib/auth/session', () => ({
  requireSession: async () => session.current,
  toSignInOrThrow: () => {
    throw new Error('UNAUTHENTICATED')
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { archiveCategoryAction, createCategoryAction, saveCategoryAction } = await import(
  '@/app/(app)/settings/categories/actions'
)
const { createRuleAction, deleteRuleAction } = await import('@/app/(app)/settings/rules/actions')
const { DUPLICATE_RULE_ERROR, UNKNOWN_CATEGORY_ERROR } = await import(
  '@/app/(app)/settings/categories/state'
)

const EMPTY = { error: null, message: null }

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
  return { db, householdId }
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

it('creates a household category', async () => {
  const { db, householdId } = await seedHousehold()

  await createCategoryAction(EMPTY, form({ name: 'Presentes' }))

  const names = (await listCategories(db, householdId)).map((c) => c.name)
  expect(names).toContain('Presentes')
})

it('rejects an empty category name instead of creating a blank row', async () => {
  const { db, householdId } = await seedHousehold()
  const before = await listCategories(db, householdId)

  const result = await createCategoryAction(EMPTY, form({ name: '   ' }))

  expect(result.error).not.toBeNull()
  expect(await listCategories(db, householdId)).toHaveLength(before.length)
})

it('renames a category without disturbing its seed key', async () => {
  const { db, householdId } = await seedHousehold()
  const [supermarket] = await listCategories(db, householdId)

  await saveCategoryAction(
    EMPTY,
    form({ categoryId: supermarket.id, name: 'Mercado', group: supermarket.group }),
  )

  const [renamed] = await listCategories(db, householdId)
  expect(renamed.name).toBe('Mercado')
  expect(renamed.seedKey).toBe('supermarket')
  expect(renamed.group).toBe(supermarket.group)
})

it('saves a rename and a move to another block in one write', async () => {
  const { db, householdId } = await seedHousehold()
  const [supermarket] = await listCategories(db, householdId)

  await saveCategoryAction(
    EMPTY,
    form({ categoryId: supermarket.id, name: 'Mercado', group: 'DESPESA_FIXA' }),
  )

  const [saved] = await listCategories(db, householdId)
  expect(saved.name).toBe('Mercado')
  expect(saved.group).toBe('DESPESA_FIXA')
})

it('refuses a block that is not one of the four rather than 500ing on the enum', async () => {
  const { db, householdId } = await seedHousehold()
  const [supermarket] = await listCategories(db, householdId)

  // A select is not a promise: the value arrives as a string from a form the
  // browser is free to have edited, and Postgres rejects an unknown enum with
  // an error no catch arm here would match.
  const result = await saveCategoryAction(
    EMPTY,
    form({ categoryId: supermarket.id, name: 'Mercado', group: 'DESPESA_IMAGINARIA' }),
  )

  expect(result.error).not.toBeNull()
  const [unchanged] = await listCategories(db, householdId)
  expect(unchanged.name).toBe(supermarket.name)
})

it('archives a category so it leaves the picker but keeps its history', async () => {
  const { db, householdId } = await seedHousehold()
  const [supermarket] = await listCategories(db, householdId)

  await archiveCategoryAction(EMPTY, form({ categoryId: supermarket.id }))

  const visible = await listCategories(db, householdId)
  expect(visible.map((c) => c.id)).not.toContain(supermarket.id)
  const all = await listCategories(db, householdId, { includeArchived: true })
  expect(all.map((c) => c.id)).toContain(supermarket.id)
})

it('creates a CONTAINS rule from the rules screen and backfills it', async () => {
  const { db, householdId } = await seedHousehold()
  const [supermarket] = await listCategories(db, householdId)
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: session.current.userId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution: 'Nubank',
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, connection.id)
  await insertTransaction(db, accountId, { description: 'ZAFFARI PORTO ALEG *0421' })
  await insertTransaction(db, accountId, { description: 'ZAFFARI CENTRO' })

  // The inbox only ever creates EXACT rules; this screen is the only way a
  // CONTAINS rule can come into existence.
  const result = await createRuleAction(
    EMPTY,
    form({ matchType: 'CONTAINS', pattern: 'ZAFFARI', categoryId: supermarket.id }),
  )

  expect(result.error).toBeNull()
  const rows = await listTransactions(db, householdId)
  expect(rows.every((r) => r.categoryId === supermarket.id)).toBe(true)
})

it('refuses a rule with an empty pattern', async () => {
  const { db, householdId } = await seedHousehold()
  const [supermarket] = await listCategories(db, householdId)

  const result = await createRuleAction(
    EMPTY,
    form({ matchType: 'CONTAINS', pattern: '  ', categoryId: supermarket.id }),
  )

  expect(result.error).not.toBeNull()
  expect(await listRules(db, householdId)).toEqual([])
})

it('reports a duplicate rule as a friendly error instead of a 500', async () => {
  const { db, householdId } = await seedHousehold()
  const [supermarket] = await listCategories(db, householdId)
  await createRuleAction(
    EMPTY,
    form({ matchType: 'EXACT', pattern: 'ZAFFARI', categoryId: supermarket.id }),
  )

  const result = await createRuleAction(
    EMPTY,
    form({ matchType: 'EXACT', pattern: 'ZAFFARI', categoryId: supermarket.id }),
  )

  expect(result.error).toBe(DUPLICATE_RULE_ERROR)
  expect(await listRules(db, householdId)).toHaveLength(1)
})

it('reports a category from another household as a friendly error instead of a 500', async () => {
  const { db, householdId } = await seedHousehold()
  const { householdId: otherHouseholdId } = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })
  const [otherCategory] = await listCategories(db, otherHouseholdId)

  const result = await createRuleAction(
    EMPTY,
    form({ matchType: 'EXACT', pattern: 'ZAFFARI', categoryId: otherCategory.id }),
  )

  expect(result.error).toBe(UNKNOWN_CATEGORY_ERROR)
  expect(await listRules(db, householdId)).toEqual([])
})

it('deletes a rule from the rules screen', async () => {
  const { db, householdId } = await seedHousehold()
  const [supermarket] = await listCategories(db, householdId)
  const { ruleId } = await createRule(db, householdId, {
    matchType: 'EXACT',
    pattern: 'ZAFFARI',
    categoryId: supermarket.id,
  })

  await deleteRuleAction(EMPTY, form({ ruleId }))

  expect(await listRules(db, householdId)).toEqual([])
})
