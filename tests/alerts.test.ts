import { eq } from 'drizzle-orm'
import { beforeEach, expect, it } from 'vitest'
import { evaluateAndNotify } from '@/lib/alerts/evaluate'
import { hashPassword } from '@/lib/auth/password'
import { listFiredAlerts } from '@/lib/db/alerts'
import { clearBudget, setBudget } from '@/lib/db/budgets'
import { archiveCategory, listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { connections, transactions } from '@/lib/db/schema'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { createRecordingMailer } from './helpers/mailer'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

/** The 10th of August, so the month is well underway but not over. */
const NOW = new Date('2026-08-10T15:00:00.000Z')

async function seedHousehold() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: {
      email: 'inacio@example.com',
      name: 'Inacio',
      passwordHash: await hashPassword('pw'),
    },
  })
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution: 'Nubank',
      status: 'UPDATED',
      lastSyncedAt: NOW,
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, connection.id)
  return { db, householdId, accountId }
}

async function categoryNamed(householdId: string, name: string): Promise<string> {
  const all = await listCategories(testDb(), householdId)
  return all.find((c) => c.name === name)!.id
}

/**
 * insertTransaction is a raw seed and deliberately leaves category_id unset,
 * so tests that need a categorized row set it themselves rather than running
 * the whole recategorize pass.
 */
async function spend(
  householdId: string,
  accountId: string,
  categoryId: string,
  amountCents: number,
): Promise<string> {
  const db = testDb()
  const id = await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    amountCents,
    date: '2026-08-05',
  })
  await db
    .update(transactions)
    .set({ categoryId, categorySource: 'RULE' })
    .where(eq(transactions.id, id))
  return id
}

it('notifies once when a category crosses 80 per cent, and re-arms when the budget is raised', async () => {
  // The parent spec's required case 6.
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await setBudget(db, householdId, {
    categoryId: supermarket,
    period: '2026-08',
    amountCents: 100_000,
  })
  await spend(householdId, accountId, supermarket, 85_000)
  const { mailer, sent } = createRecordingMailer()

  await evaluateAndNotify(db, mailer, householdId, { now: NOW })
  await evaluateAndNotify(db, mailer, householdId, { now: NOW })
  await evaluateAndNotify(db, mailer, householdId, { now: NOW })

  expect(sent).toHaveLength(1)
  expect(sent[0].subject).toBe('Supermercado is at 80% of its budget')
  expect(sent[0].to).toEqual(['inacio@example.com'])

  // Raising the budget puts spend back under the threshold, which re-arms it.
  await setBudget(db, householdId, {
    categoryId: supermarket,
    period: '2026-08',
    amountCents: 200_000,
  })
  await evaluateAndNotify(db, mailer, householdId, { now: NOW })
  expect(sent).toHaveLength(1)
  expect(await listFiredAlerts(db, householdId, '2026-08')).toEqual([])

  // ...and a genuine second crossing fires again.
  await spend(householdId, accountId, supermarket, 80_000)
  await evaluateAndNotify(db, mailer, householdId, { now: NOW })
  expect(sent).toHaveLength(2)
})

it('batches every crossing in one evaluation into a single message', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  const restaurants = await categoryNamed(householdId, 'Restaurantes')
  for (const categoryId of [supermarket, restaurants]) {
    await setBudget(db, householdId, { categoryId, period: '2026-08', amountCents: 100_000 })
  }
  // Supermercado crosses both thresholds; Restaurantes crosses only 80.
  await spend(householdId, accountId, supermarket, 130_000)
  await spend(householdId, accountId, restaurants, 85_000)
  const { mailer, sent } = createRecordingMailer()

  await evaluateAndNotify(db, mailer, householdId, { now: NOW })

  expect(sent).toHaveLength(1)
  expect(sent[0].subject).toBe('2 categories crossed a budget threshold')
  expect(sent[0].text.split('\n').filter((l) => l.includes('R$'))).toHaveLength(3)
  expect(await listFiredAlerts(db, householdId, '2026-08')).toHaveLength(3)
})

it('re-arms when a transaction is recategorized out of the category', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  const restaurants = await categoryNamed(householdId, 'Restaurantes')
  await setBudget(db, householdId, {
    categoryId: supermarket,
    period: '2026-08',
    amountCents: 100_000,
  })
  const txId = await spend(householdId, accountId, supermarket, 85_000)
  const { mailer, sent } = createRecordingMailer()
  await evaluateAndNotify(db, mailer, householdId, { now: NOW })
  expect(sent).toHaveLength(1)

  await db
    .update(transactions)
    .set({ categoryId: restaurants, categorySource: 'MANUAL' })
    .where(eq(transactions.id, txId))
  await evaluateAndNotify(db, mailer, householdId, { now: NOW })

  expect(await listFiredAlerts(db, householdId, '2026-08')).toEqual([])
  expect(sent).toHaveLength(1)
})

it('clears fired state when the budget is deleted, and sends nothing', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await setBudget(db, householdId, {
    categoryId: supermarket,
    period: '2026-08',
    amountCents: 100_000,
  })
  await spend(householdId, accountId, supermarket, 85_000)
  const { mailer, sent } = createRecordingMailer()
  await evaluateAndNotify(db, mailer, householdId, { now: NOW })

  await clearBudget(db, householdId, { categoryId: supermarket, period: '2026-08' })
  await evaluateAndNotify(db, mailer, householdId, { now: NOW })

  expect(await listFiredAlerts(db, householdId, '2026-08')).toEqual([])
  expect(sent).toHaveLength(1)
})

it('clears fired state for a category that has been archived', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await setBudget(db, householdId, {
    categoryId: supermarket,
    period: '2026-08',
    amountCents: 100_000,
  })
  await spend(householdId, accountId, supermarket, 85_000)
  const { mailer } = createRecordingMailer()
  await evaluateAndNotify(db, mailer, householdId, { now: NOW })

  await archiveCategory(db, householdId, supermarket)
  await evaluateAndNotify(db, mailer, householdId, { now: NOW })

  expect(await listFiredAlerts(db, householdId, '2026-08')).toEqual([])
})

it('leaves the threshold armed when the send fails, and delivers on the next evaluation', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await setBudget(db, householdId, {
    categoryId: supermarket,
    period: '2026-08',
    amountCents: 100_000,
  })
  await spend(householdId, accountId, supermarket, 85_000)
  const { mailer, sent, failNext } = createRecordingMailer()

  failNext()
  await expect(evaluateAndNotify(db, mailer, householdId, { now: NOW })).rejects.toThrow(
    /RESEND_FAILED/,
  )
  // Nothing recorded, because nothing was delivered.
  expect(await listFiredAlerts(db, householdId, '2026-08')).toEqual([])

  await evaluateAndNotify(db, mailer, householdId, { now: NOW })
  expect(sent).toHaveLength(1)
  expect(await listFiredAlerts(db, householdId, '2026-08')).toHaveLength(1)
})

it('sends nothing when no category has a budget', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await spend(householdId, accountId, supermarket, 500_000)
  const { mailer, sent } = createRecordingMailer()

  await evaluateAndNotify(db, mailer, householdId, { now: NOW })

  expect(sent).toEqual([])
})

it('ignores transfers, so paying a card invoice never trips a threshold', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const supermarket = await categoryNamed(householdId, 'Supermercado')
  await setBudget(db, householdId, {
    categoryId: supermarket,
    period: '2026-08',
    amountCents: 100_000,
  })
  const txId = await spend(householdId, accountId, supermarket, 500_000)
  await db.update(transactions).set({ isTransfer: true }).where(eq(transactions.id, txId))
  const { mailer, sent } = createRecordingMailer()

  await evaluateAndNotify(db, mailer, householdId, { now: NOW })

  expect(sent).toEqual([])
})
