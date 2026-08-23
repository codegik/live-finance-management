import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listAccounts, listConnections } from '@/lib/db/connections'
import { createHousehold } from '@/lib/db/households'
import { listTransactions } from '@/lib/db/transactions'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { syncConnection } from '@/lib/sync/transactions'
import accountsFixture from './fixtures/pluggy/accounts.json'
import { resetDb, testDb } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'

const server = startPluggyServer()

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

it('keeps a date-only (UTC midnight) transaction on its own calendar date', async () => {
  const { db, householdId, connectionId } = await seedConnection()

  await syncConnection(db, pluggy(), connectionId)
  const rows = await listTransactions(db, householdId)

  const dateOnly = rows.find((r) => r.pluggyTransactionId === 'tx-date-only')!

  // Pluggy pads a credit-card transaction whose time of day is unknown to
  // exactly T00:00:00.000Z. Converting that as a real instant would move it
  // to 2026-07-31 -- shifting every such transaction a day early, and every
  // one on the 1st into the previous month.
  expect(dateOnly.date).toBe('2026-08-01')
})

it('keeps a bare date (no time component) on its own calendar date', async () => {
  const { db, householdId, connectionId } = await seedConnection()

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/v2/transactions', () =>
      HttpResponse.json({
        page: 1,
        next: null,
        results: [
          {
            id: 'tx-bare-date',
            accountId: 'acc-credit-1',
            description: 'ASSINATURA STREAMING',
            amount: 45.0,
            date: '2026-08-01',
            type: 'DEBIT',
            category: 'Subscriptions',
          },
        ],
      }),
    ),
  )

  await syncConnection(db, pluggy(), connectionId)
  const rows = await listTransactions(db, householdId)

  // A bare YYYY-MM-DD carries no time-of-day at all, so it cannot be a
  // genuine instant -- there is no trade-off here, only a bug if it moved.
  expect(rows.find((r) => r.pluggyTransactionId === 'tx-bare-date')!.date).toBe('2026-08-01')
})

it('converts a UTC-midnight transaction as the instant it is', async () => {
  const { db, householdId, connectionId } = await seedConnection()

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/v2/transactions', () =>
      HttpResponse.json({
        page: 1,
        next: null,
        results: [
          {
            id: 'tx-offset-midnight',
            accountId: 'acc-credit-1',
            description: 'ASSINATURA STREAMING',
            amount: 45.0,
            date: '2026-08-01T00:00:00.000+00:00',
            type: 'DEBIT',
            category: 'Subscriptions',
          },
        ],
      }),
    ),
  )

  await syncConnection(db, pluggy(), connectionId)
  const rows = await listTransactions(db, householdId)

  // 00:00Z is 21:00 the previous day in Sao Paulo. A live payload shows
  // Pluggy pads calendar dates to LOCAL midnight (03:00Z), never 00:00Z, so
  // a value spelled this way is a real instant and converting it is correct.
  expect(rows.find((r) => r.pluggyTransactionId === 'tx-offset-midnight')!.date).toBe(
    '2026-07-31',
  )
})

it('rejects a transaction with a missing amount instead of storing R$ 0,00', async () => {
  const { db, householdId, connectionId } = await seedConnection()

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/v2/transactions', () =>
      HttpResponse.json({
        page: 1,
        next: null,
        results: [
          {
            id: 'tx-no-amount',
            accountId: 'acc-credit-1',
            description: 'SEM VALOR',
            amount: null,
            date: '2026-08-20T14:02:00.000Z',
            type: 'DEBIT',
          },
        ],
      }),
    ),
  )

  // A zero-value row is the spec's named worst case: spend that vanishes from
  // every total while the ledger still looks healthy. Fail the sync instead --
  // the connection stays stale and the banner says so.
  await expect(syncConnection(db, pluggy(), connectionId)).rejects.toThrow(
    /PLUGGY_INVALID_TRANSACTION/,
  )
  expect(await listTransactions(db, householdId)).toHaveLength(0)
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
    http.get('https://api.pluggy.test/v2/transactions', () =>
      HttpResponse.json({
        page: 1,
        next: null,
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

it('attributes transactions to the correct account and reports the true upserted count', async () => {
  const { db, householdId, connectionId } = await seedConnection()

  const result = await syncConnection(db, pluggy(), connectionId)
  const rows = await listTransactions(db, householdId)

  const purchase = rows.find((r) => r.pluggyTransactionId === 'tx-1')!
  const bankFee = rows.find((r) => r.pluggyTransactionId === 'tx-bank-1')!

  expect(purchase.accountName).toBe('Cartao Nubank')
  expect(bankFee.accountName).toBe('Conta Nubank')
  expect(result.upserted).toBe(6)
})

it('records the sync time and status on the connection', async () => {
  const { db, householdId, connectionId } = await seedConnection()

  await syncConnection(db, pluggy(), connectionId)
  const [connection] = await listConnections(db, householdId)

  expect(connection.lastSyncedAt).not.toBeNull()
  expect(connection.status).toBe('UPDATED')
})

it('does not leak transactions across households', async () => {
  const { db, householdId, connectionId } = await seedConnection()
  await syncConnection(db, pluggy(), connectionId)

  const other = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })

  expect(await listTransactions(db, other.householdId)).toHaveLength(0)
  expect(await listTransactions(db, householdId)).not.toHaveLength(0)
})

it('picks up an account opened on an already-connected login', async () => {
  const { db, householdId, connectionId } = await seedConnection()

  const { http, HttpResponse } = await import('msw')
  // The same item now reports a second account. Until refreshAccounts ran on
  // every sync, this account -- and every transaction in it -- was invisible
  // until the connection was removed and re-added.
  server.use(
    http.get('https://api.pluggy.test/accounts', () =>
      HttpResponse.json({
        results: [
          ...accountsFixture.results,
          {
            id: 'acc-bank-2',
            itemId: 'item-nubank-1',
            type: 'BANK',
            name: 'Conta Poupanca',
            number: '5555',
          },
        ],
      }),
    ),
  )

  await syncConnection(db, pluggy(), connectionId)

  const rows = await listAccounts(db, householdId)
  expect(rows.map((r) => r.pluggyAccountId)).toContain('acc-bank-2')
})
