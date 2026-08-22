import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { listTransactions } from '@/lib/db/transactions'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { syncConnection } from '@/lib/sync/transactions'
import { resetDb, testDb } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'

const server = startPluggyServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(resetDb)

function pluggy() {
  return createPluggyClient({
    apiUrl: 'https://api.pluggy.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  })
}

async function seedConnection() {
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
  return { db, householdId, connectionId }
}

it('stores transactions in centavos with expenses positive and refunds negative', async () => {
  const { db, householdId, connectionId } = await seedConnection()

  await syncConnection(db, pluggy(), connectionId)
  const rows = await listTransactions(db, householdId)

  const purchase = rows.find((r) => r.pluggyTransactionId === 'tx-1')!
  const refund = rows.find((r) => r.pluggyTransactionId === 'tx-refund')!

  expect(purchase.amountCents).toBe(28490)
  expect(refund.amountCents).toBe(-3000)
})

it('buckets a late-night purchase into the Sao Paulo calendar date, not the UTC one', async () => {
  const { db, householdId, connectionId } = await seedConnection()

  await syncConnection(db, pluggy(), connectionId)
  const rows = await listTransactions(db, householdId)

  const lateNight = rows.find((r) => r.pluggyTransactionId === 'tx-late-night')!

  expect(lateNight.date).toBe('2026-07-31')
})

it('is idempotent: re-syncing changes no totals and creates no duplicates', async () => {
  const { db, householdId, connectionId } = await seedConnection()

  await syncConnection(db, pluggy(), connectionId)
  const first = await listTransactions(db, householdId)

  await syncConnection(db, pluggy(), connectionId)
  const second = await listTransactions(db, householdId)

  expect(second).toHaveLength(first.length)
  expect(sum(second)).toBe(sum(first))

  function sum(rows: { amountCents: number }[]) {
    return rows.reduce((total, r) => total + r.amountCents, 0)
  }
})

it('updates an amount that changed between syncs rather than inserting a second row', async () => {
  const { db, householdId, connectionId } = await seedConnection()
  await syncConnection(db, pluggy(), connectionId)

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/transactions', () =>
      HttpResponse.json({
        page: 1,
        totalPages: 1,
        results: [
          {
            id: 'tx-1',
            accountId: 'acc-credit-1',
            description: 'ZAFFARI PORTO ALEG *0421',
            amount: 301.15,
            date: '2026-08-20T14:02:00.000Z',
            type: 'DEBIT',
            category: 'Supermarkets',
          },
        ],
      }),
    ),
  )

  await syncConnection(db, pluggy(), connectionId)
  const rows = await listTransactions(db, householdId)

  expect(rows.filter((r) => r.pluggyTransactionId === 'tx-1')).toHaveLength(1)
  expect(rows.find((r) => r.pluggyTransactionId === 'tx-1')!.amountCents).toBe(30115)
})

it('records the sync time and does not cross households', async () => {
  const { db, householdId, connectionId } = await seedConnection()
  await syncConnection(db, pluggy(), connectionId)

  const other = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })

  expect(await listTransactions(db, other.householdId)).toHaveLength(0)
  expect(await listTransactions(db, householdId)).not.toHaveLength(0)
})
