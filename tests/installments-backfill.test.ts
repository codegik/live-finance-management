import { eq } from 'drizzle-orm'
import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { connections, transactions } from '@/lib/db/schema'
import { recategorize } from '@/lib/sync/categorize'
import { refreshInstallments } from '@/lib/sync/installments'
import { getMonthView } from '@/lib/views/month'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

const NOW = new Date('2026-08-24T15:00:00.000Z')

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
  const accountId = await seedAccount(db, connection.id)
  return { db, householdId, accountId }
}

/**
 * The columns arrived in drizzle/0006_budgets.sql with no backfill, and Pluggy
 * never re-delivers an old transaction -- so every row already in the table
 * stayed NULL for good. On the live connection that was all 1,537 of them.
 *
 * insertTransaction parses the descriptor itself, exactly as the ingest path
 * does, so these tests null the columns explicitly to reproduce a row that
 * predates them. That is the state this pass exists to repair.
 */
async function unflag(db: ReturnType<typeof testDb>, id: string) {
  await db
    .update(transactions)
    .set({ installmentNumber: null, installmentTotal: null })
    .where(eq(transactions.id, id))
}

it('reads the instalment out of a descriptor that predates the columns', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const id = await insertTransaction(db, accountId, {
    description: 'AUTO MECANICA BOA 06/10',
    amountCents: 114_709,
    date: '2026-09-15',
  })
  await unflag(db, id)

  const { changed } = await refreshInstallments(db, householdId)

  expect(changed).toBe(1)
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id))
  expect(row.installmentNumber).toBe(6)
  expect(row.installmentTotal).toBe(10)
})

it('reads the descriptors a real Itau statement actually emits', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  // Observed on the live connection. The counter is jammed against the
  // merchant text with no separator, which is why word boundaries were never
  // an option in the parser.
  const observed: [string, number, number][] = [
    ['MARCO AURELIO CARV07/12', 7, 12],
    ['CentroDeIdiomasIVO05/09', 5, 9],
    ['CLUBE LIVELO*Clube02/12', 2, 12],
    ['HOTEIS.COM        10/12', 10, 12],
    ['SHEIN  *SHEIN.COMV03/03', 3, 3],
  ]
  for (const [description] of observed) {
    await unflag(db, await insertTransaction(db, accountId, { description, date: '2026-09-15' }))
  }

  await refreshInstallments(db, householdId)

  const rows = await db.select().from(transactions)
  for (const [description, number, total] of observed) {
    const row = rows.find((r) => r.description === description)!
    expect([row.installmentNumber, row.installmentTotal]).toEqual([number, total])
  }
})

it('stops pace extrapolating a parcela as if it were a daily rate', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  // A single large instalment, dated early in a month that is still running.
  await unflag(
    db,
    await insertTransaction(db, accountId, {
      description: 'AUTO MECANICA BOA 05/10',
      amountCents: 114_709,
      date: '2026-08-06',
      pluggyCategory: 'Vehicle maintenance',
    }),
  )
  await recategorize(db, { householdId })

  // Read on the 10th, so 10 days of 31 have elapsed. Unflagged, the instalment
  // is variable spending and pace treats it as a rate: R$1.147,09 over 10 days
  // projects R$3.555,98 by month end -- three times money that was never going
  // to be spent again.
  const onTheTenth = { now: new Date('2026-08-10T15:00:00.000Z') }
  const before = await getMonthView(db, householdId, '2026-08', onTheTenth)
  const beforeRow = before.groups
    .flatMap((g) => g.rows)
    .find((r) => r.categoryName === 'Manutenção de carro')!
  expect(beforeRow.paceCents).toBeGreaterThan(300_000)

  await refreshInstallments(db, householdId)

  // Flagged, it is a known list and is added at face value.
  const after = await getMonthView(db, householdId, '2026-08', onTheTenth)
  const afterRow = after.groups
    .flatMap((g) => g.rows)
    .find((r) => r.categoryName === 'Manutenção de carro')!
  expect(afterRow.paceCents).toBe(114_709)
  expect(afterRow.committedCents).toBe(114_709)
})

it('clears a stored parse that the descriptor no longer supports', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const id = await insertTransaction(db, accountId, { description: 'ZAFFARI CENTRO' })
  await db
    .update(transactions)
    .set({ installmentNumber: 3, installmentTotal: 12 })
    .where(eq(transactions.id, id))

  const { changed } = await refreshInstallments(db, householdId)

  // Left in place, this is a phantom commitment: pace would stop extrapolating
  // an ordinary purchase, and the paying-month shift would skip it as though
  // the connector had already billed it.
  expect(changed).toBe(1)
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id))
  expect(row.installmentTotal).toBeNull()
})

it('does not read a Brazilian date as a parcel', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await insertTransaction(db, accountId, { description: 'PAGTO DEBITO 01/12/24' })
  await insertTransaction(db, accountId, { description: 'POSTO 44710/12' })

  await refreshInstallments(db, householdId)

  const rows = await db.select().from(transactions)
  expect(rows.every((r) => r.installmentTotal === null)).toBe(true)
})

it('is a no-op the second time, so the nightly pass costs nothing', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await unflag(
    db,
    await insertTransaction(db, accountId, { description: 'AUTO MECANICA BOA 06/10' }),
  )

  expect((await refreshInstallments(db, householdId)).changed).toBe(1)
  expect((await refreshInstallments(db, householdId)).changed).toBe(0)
})

it('never touches another household', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await unflag(
    db,
    await insertTransaction(db, accountId, { description: 'AUTO MECANICA BOA 06/10' }),
  )
  const { householdId: otherId } = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })

  expect((await refreshInstallments(db, otherId)).changed).toBe(0)
  expect((await refreshInstallments(db, householdId)).changed).toBe(1)
})
