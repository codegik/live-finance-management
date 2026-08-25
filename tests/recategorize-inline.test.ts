import { eq } from 'drizzle-orm'
import { beforeEach, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { connections, transactions } from '@/lib/db/schema'
import { recategorize } from '@/lib/sync/categorize'
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

const { setTransactionCategoryAction } = await import('@/app/(app)/dashboard/actions')
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
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution: 'Itau',
      status: 'UPDATED',
    })
    .returning({ id: connections.id })
  return { db, householdId, accountId: await seedAccount(db, connection.id) }
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.append(k, v)
  return data
}

async function categoryNamed(householdId: string, name: string): Promise<string> {
  const all = await listCategories(testDb(), householdId)
  return all.find((c) => c.name === name)!.id
}

it('moves one transaction to another category', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const txId = await insertTransaction(db, accountId, {
    description: 'MERCADOLIVRE*MERCA02/10',
    amountCents: 29_853,
    date: '2026-09-15',
    pluggyCategory: 'Houseware',
  })
  await recategorize(db, { householdId })
  const lazer = await categoryNamed(householdId, 'Lazer')

  const result = await setTransactionCategoryAction(
    EMPTY,
    form({ transactionId: txId, categoryId: lazer }),
  )

  expect(result.error).toBeNull()
  const [row] = await db.select().from(transactions).where(eq(transactions.id, txId))
  expect(row.categoryId).toBe(lazer)
})

it('survives the nightly recategorize', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const txId = await insertTransaction(db, accountId, {
    description: 'MERCADOLIVRE*MERCA02/10',
    amountCents: 29_853,
    date: '2026-09-15',
    // Pluggy maps 'Houseware' to Casa, so the nightly pass has an opinion
    // about this row and it disagrees with the household's.
    pluggyCategory: 'Houseware',
  })
  await recategorize(db, { householdId })
  const lazer = await categoryNamed(householdId, 'Lazer')
  await setTransactionCategoryAction(EMPTY, form({ transactionId: txId, categoryId: lazer }))

  await recategorize(db, { householdId })

  // The correction is stored MANUAL, which recategorize excludes in its query
  // predicate. A fix that silently reverts overnight is worse than no fix:
  // the household stops trusting the screen rather than the mapping.
  const [row] = await db.select().from(transactions).where(eq(transactions.id, txId))
  expect(row.categoryId).toBe(lazer)
  expect(row.categorySource).toBe('MANUAL')
})

it('refuses a category belonging to another household', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const txId = await insertTransaction(db, accountId, { description: 'ZAFFARI' })
  const before = (await db.select().from(transactions).where(eq(transactions.id, txId)))[0]
  const { householdId: otherId } = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })
  const theirs = await categoryNamed(otherId, 'Lazer')

  const result = await setTransactionCategoryAction(
    EMPTY,
    form({ transactionId: txId, categoryId: theirs }),
  )

  expect(result.error).not.toBeNull()
  const [after] = await db.select().from(transactions).where(eq(transactions.id, txId))
  expect(after.categoryId).toBe(before.categoryId)
})

it('reports a malformed id as a message rather than a 500', async () => {
  await seedHousehold()

  // Postgres throws 22P02 on a non-UUID reaching eq(<uuid column>, value), and
  // that escapes as a server error rather than something the screen can say.
  const bad = await setTransactionCategoryAction(
    EMPTY,
    form({ transactionId: 'not-a-uuid', categoryId: crypto.randomUUID() }),
  )
  expect(bad.error).not.toBeNull()
})
