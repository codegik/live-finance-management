import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { syncConnection } from '@/lib/sync/transactions'
import { getLedgerView } from '@/lib/views/ledger'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'

const server = startPluggyServer()

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

function pluggy() {
  return createPluggyClient({
    apiUrl: 'https://api.pluggy.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  })
}

async function seedSynced() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const { connectionId } = await attachConnection(db, pluggy(), {
    householdId,
    ownerUserId: userId,
    itemId: 'item-nubank-1',
  })
  await syncConnection(db, pluggy(), connectionId)
  return { db, householdId }
}

it('groups transactions by day, newest first, with a daily total', async () => {
  const { db, householdId } = await seedSynced()

  const view = await getLedgerView(db, householdId)

  // The fixture also syncs a bank-account fee (tx-bank-1) on 2026-08-10 --
  // the brief's original expectation omitted it, but listTransactions (and
  // Task 7's own tests) include every synced account, credit or bank. A
  // ledger that silently dropped a real transaction would be exactly the
  // "looks healthy but is wrong" failure this screen exists to avoid.
  expect(view.days.map((d) => d.date)).toEqual([
    '2026-08-21',
    '2026-08-20',
    // A foreign-currency purchase, stored at its account-currency value.
    '2026-08-19',
    '2026-08-10',
    // tx-date-only arrives padded to Sao Paulo midnight (03:00Z), which is
    // how Pluggy actually spells a calendar date. It must stay on the 1st.
    '2026-08-01',
    '2026-07-31',
  ])

  const refundDay = view.days.find((d) => d.date === '2026-08-21')!
  expect(refundDay.totalCents).toBe(-3000)

  const purchaseDay = view.days.find((d) => d.date === '2026-08-20')!
  expect(purchaseDay.totalCents).toBe(28490)

  const bankFeeDay = view.days.find((d) => d.date === '2026-08-10')!
  expect(bankFeeDay.totalCents).toBe(1290)
})

it('attributes each transaction to a card and to the person who connected it', async () => {
  const { db, householdId } = await seedSynced()

  const view = await getLedgerView(db, householdId)
  const item = view.days.find((d) => d.date === '2026-08-20')!.items[0]

  expect(item.institution).toBe('Nubank')
  expect(item.accountLast4).toBe('1234')
  expect(item.ownerName).toBe('Inacio')
})

it('carries household health so the view can never render silently stale', async () => {
  const { db, householdId } = await seedSynced()

  const view = await getLedgerView(db, householdId)

  expect(view.health.allFresh).toBe(true)
})

it('returns an empty ledger rather than throwing for a household with no connections', async () => {
  const db = testDb()
  const { householdId } = await createHousehold(db, {
    name: 'Fresh',
    owner: { email: 'fresh@example.com', name: 'Fresh', passwordHash: await hashPassword('pw') },
  })

  const view = await getLedgerView(db, householdId)

  expect(view.days).toEqual([])
  expect(view.health.allFresh).toBe(true)
})

it("carries each transaction's category and the uncategorized count", async () => {
  const { db, householdId } = await seedSynced()

  const view = await getLedgerView(db, householdId)

  const zaffari = view.days
    .flatMap((d) => d.items)
    .find((i) => i.description === 'ZAFFARI PORTO ALEG *0421')!
  expect(zaffari.categoryName).toBe('Supermercado')

  // The bank fee's Pluggy category ('Fees') is deliberately unmapped, so it
  // is the one transaction still waiting in the inbox.
  const fee = view.days.flatMap((d) => d.items).find((i) => i.description === 'TARIFA MANUTENCAO CONTA')!
  expect(fee.categoryName).toBeNull()
  expect(view.uncategorizedCount).toBeGreaterThan(0)
})
