import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { getLedgerView } from '@/lib/views/ledger'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

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
      institution: 'Itau',
      status: 'UPDATED',
    })
    .returning({ id: connections.id })
  return { db, householdId, accountId: await seedAccount(db, connection.id) }
}

/** One transaction per day, so day grouping never merges two rows onto a page. */
async function seedDays(
  db: ReturnType<typeof testDb>,
  accountId: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const day = String(i + 1).padStart(2, '0')
    await insertTransaction(db, accountId, {
      description: `COMPRA ${day}`,
      amountCents: 1_000,
      date: `2026-08-${day}`,
    })
  }
}

function descriptions(view: { days: { items: { description: string }[] }[] }): string[] {
  return view.days.flatMap((day) => day.items).map((item) => item.description)
}

it('returns only a page of rows, reporting where the page sits', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await seedDays(db, accountId, 5)

  const view = await getLedgerView(db, householdId, { page: 1, pageSize: 2 })

  // Newest first: day 05 and 04 are the first page.
  expect(descriptions(view)).toEqual(['COMPRA 05', 'COMPRA 04'])
  expect(view.pagination).toEqual({
    page: 1,
    pageSize: 2,
    total: 5,
    pageCount: 3,
    hasPrev: false,
    hasNext: true,
  })
})

it('walks pages without overlapping or dropping a row', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await seedDays(db, accountId, 5)

  const pages = await Promise.all(
    [1, 2, 3].map((page) => getLedgerView(db, householdId, { page, pageSize: 2 })),
  )

  expect(pages.map(descriptions)).toEqual([
    ['COMPRA 05', 'COMPRA 04'],
    ['COMPRA 03', 'COMPRA 02'],
    ['COMPRA 01'],
  ])
  expect(pages[2].pagination.hasNext).toBe(false)
  expect(pages[2].pagination.hasPrev).toBe(true)
})

it('clamps a page past the end back to the last real page', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await seedDays(db, accountId, 5)

  // A bookmark to page 9 of a statement since trimmed must not show an empty
  // list -- it lands on the last page that has rows.
  const view = await getLedgerView(db, householdId, { page: 9, pageSize: 2 })

  expect(view.pagination.page).toBe(3)
  expect(descriptions(view)).toEqual(['COMPRA 01'])
})

it('treats a non-finite or sub-1 page as the first page', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await seedDays(db, accountId, 3)

  for (const page of [Number.NaN, 0, -4]) {
    const view = await getLedgerView(db, householdId, { page, pageSize: 2 })
    expect(view.pagination.page).toBe(1)
    expect(descriptions(view)).toEqual(['COMPRA 03', 'COMPRA 02'])
  }
})

it('counts and sums every match, not just the rows on the page', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  await seedDays(db, accountId, 5)

  const view = await getLedgerView(db, householdId, { page: 1, pageSize: 2 })

  // The page shows 2 rows summing R$ 20,00...
  expect(view.itemCount).toBe(2)
  expect(view.totalCents).toBe(2_000)
  // ...but the search summary needs the totals across all 5 matches.
  expect(view.matchCount).toBe(5)
  expect(view.matchTotalCents).toBe(5_000)
})

it('reports a single page and no grand-total surprise for an empty ledger', async () => {
  const { db, householdId } = await seedHousehold()

  const view = await getLedgerView(db, householdId, { pageSize: 2 })

  expect(view.days).toEqual([])
  expect(view.matchCount).toBe(0)
  expect(view.matchTotalCents).toBe(0)
  expect(view.pagination).toMatchObject({ page: 1, pageCount: 1, hasPrev: false, hasNext: false })
})
