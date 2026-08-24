import { eq } from 'drizzle-orm'
import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { accounts, connections } from '@/lib/db/schema'
import { recategorize } from '@/lib/sync/categorize'
import { refreshBudgetMonths } from '@/lib/sync/budget-month'
import { refreshInstallments } from '@/lib/sync/installments'
import { getMonthView } from '@/lib/views/month'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

const NOW = new Date('2026-08-24T15:00:00.000Z')

/** The household's real card: closes on the 5th, falls due on the 17th. */
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
      institution: 'Itau',
      status: 'UPDATED',
      lastSyncedAt: NOW,
    })
    .returning({ id: connections.id })
  const cardId = await seedAccount(db, connection.id)
  await db.update(accounts).set({ dueDay: 17, closingDay: 5 }).where(eq(accounts.id, cardId))
  const bankId = await seedAccount(db, connection.id, { type: 'BANK', name: 'Conta' })
  return { db, householdId, cardId, bankId }
}

async function refresh(db: ReturnType<typeof testDb>, householdId: string) {
  await refreshInstallments(db, householdId)
  await refreshBudgetMonths(db, householdId)
  await recategorize(db, { householdId })
}

function spend(view: Awaited<ReturnType<typeof getMonthView>>): number {
  return view.expenseCents
}

it('files a card purchase in the month its fatura is paid, not the month it was bought', async () => {
  const { db, householdId, cardId } = await seedHousehold()
  // Bought 10/08. The bill closes 05/09 and falls due 17/09, so the money
  // leaves in September -- which is the month the household budgets it in.
  await insertTransaction(db, cardId, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-10',
    pluggyCategory: 'Groceries',
  })
  await refresh(db, householdId)

  expect(spend(await getMonthView(db, householdId, '2026-08', { now: NOW }))).toBe(0)
  expect(spend(await getMonthView(db, householdId, '2026-09', { now: NOW }))).toBe(30_000)
})

it('keeps a purchase made before the closing day on the bill already closing', async () => {
  const { db, householdId, cardId } = await seedHousehold()
  await insertTransaction(db, cardId, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-03',
    pluggyCategory: 'Groceries',
  })
  await refresh(db, householdId)

  expect(spend(await getMonthView(db, householdId, '2026-08', { now: NOW }))).toBe(30_000)
})

it('does not shift a parcela the connector already dated by its fatura', async () => {
  const { db, householdId, cardId } = await seedHousehold()
  // VERIFIED AGAINST REAL DATA: instalments 2..N arrive dated the 15th of the
  // month they are charged. Shifting them again would land every parcela a
  // month late and double-count the boundary month.
  await insertTransaction(db, cardId, {
    description: 'AUTO MECANICA BOA 06/10',
    amountCents: 114_709,
    date: '2026-09-15',
    pluggyCategory: 'Vehicle maintenance',
  })
  await refresh(db, householdId)

  expect(spend(await getMonthView(db, householdId, '2026-09', { now: NOW }))).toBe(114_709)
  expect(spend(await getMonthView(db, householdId, '2026-10', { now: NOW }))).toBe(0)
})

it('leaves a bank transaction in the month it happened', async () => {
  const { db, householdId, bankId } = await seedHousehold()
  // A PIX or a TED settles the day it happens. There is no bill to wait for.
  await insertTransaction(db, bankId, {
    description: 'PIX ALUGUEL',
    amountCents: 690_000,
    date: '2026-08-10',
    pluggyCategory: 'Rent',
  })
  await refresh(db, householdId)

  expect(spend(await getMonthView(db, householdId, '2026-08', { now: NOW }))).toBe(690_000)
  expect(spend(await getMonthView(db, householdId, '2026-09', { now: NOW }))).toBe(0)
})

it('does not move anything until a closing day is known', async () => {
  const { db, householdId, cardId } = await seedHousehold()
  await db.update(accounts).set({ closingDay: null }).where(eq(accounts.id, cardId))
  await insertTransaction(db, cardId, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-10',
    pluggyCategory: 'Groceries',
  })
  await refresh(db, householdId)

  // A guessed cycle moves money into the wrong month and looks exactly like a
  // correct answer, so an unknown closing day means no shift at all.
  expect(spend(await getMonthView(db, householdId, '2026-08', { now: NOW }))).toBe(30_000)
})

it('re-files history when the household corrects the closing day', async () => {
  const { db, householdId, cardId } = await seedHousehold()
  await insertTransaction(db, cardId, {
    description: 'ZAFFARI',
    amountCents: 30_000,
    date: '2026-08-10',
    pluggyCategory: 'Groceries',
  })
  await refresh(db, householdId)
  expect(spend(await getMonthView(db, householdId, '2026-09', { now: NOW }))).toBe(30_000)

  // The card turns out to close on the 20th and fall due on the 25th, so that
  // bill is paid the same month and the purchase belongs in August after all.
  // Editing the days has to re-file the history behind them, which is the whole
  // reason this is a pass over stored rows rather than a value computed once at
  // ingest.
  await db
    .update(accounts)
    .set({ closingDayOverride: 20, dueDayOverride: 25 })
    .where(eq(accounts.id, cardId))
  await refreshBudgetMonths(db, householdId)

  expect(spend(await getMonthView(db, householdId, '2026-08', { now: NOW }))).toBe(30_000)
  expect(spend(await getMonthView(db, householdId, '2026-09', { now: NOW }))).toBe(0)
})

it('is a no-op the second time, so the nightly pass costs nothing', async () => {
  const { db, householdId, cardId } = await seedHousehold()
  await insertTransaction(db, cardId, { description: 'ZAFFARI', date: '2026-08-10' })

  expect((await refreshBudgetMonths(db, householdId)).changed).toBe(1)
  expect((await refreshBudgetMonths(db, householdId)).changed).toBe(0)
})
