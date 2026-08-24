import { eq } from 'drizzle-orm'
import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { connections, transactions } from '@/lib/db/schema'
import { refreshInstallments } from '@/lib/sync/installments'
import { getForwardView } from '@/lib/views/forward'
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

it('fills in what "Comprometido" is built from', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  for (const [n, date] of [
    [6, '2026-09-15'],
    [7, '2026-10-15'],
    [8, '2026-11-16'],
  ] as const) {
    await unflag(
      db,
      await insertTransaction(db, accountId, {
        description: `AUTO MECANICA BOA 0${n}/10`,
        amountCents: 114_709,
        date,
        pluggyCategory: 'Vehicle maintenance',
      }),
    )
  }

  // getForwardView filters on installment_total IS NOT NULL, so before the
  // pass the screen is empty over a household with real commitments.
  const before = await getForwardView(db, householdId, { now: NOW })
  expect(before.every((m) => m.totalCommittedCents === 0)).toBe(true)

  await refreshInstallments(db, householdId)

  const after = await getForwardView(db, householdId, { now: NOW })
  expect(after.filter((m) => m.totalCommittedCents > 0)).toHaveLength(3)
})

it('clears a stored parse that the descriptor no longer supports', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const id = await insertTransaction(db, accountId, { description: 'ZAFFARI CENTRO' })
  await db
    .update(transactions)
    .set({ installmentNumber: 3, installmentTotal: 12 })
    .where(eq(transactions.id, id))

  const { changed } = await refreshInstallments(db, householdId)

  // Left in place, this is a phantom commitment: the forward view would show
  // money the household never agreed to pay.
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
