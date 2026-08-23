import { http, HttpResponse } from 'msw'
import { afterEach, beforeAll, afterAll, expect, it } from 'vitest'
import { toSaoPauloDate } from '@/lib/domain/dates'
import { mapTransaction } from '@/lib/pluggy/mapper'
import { createPluggyClient } from '@/lib/pluggy/client'
import { startPluggyServer } from './helpers/pluggy-server'

const server = startPluggyServer()

function client() {
  return createPluggyClient({
    apiUrl: 'https://api.pluggy.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  })
}

// --- the v2 endpoint ---------------------------------------------------------

it('reads transactions from /v2/transactions, not the deprecated endpoint', async () => {
  // The old /transactions endpoint now answers 410 ENDPOINT_DEPRECATED in
  // production, which threw and left every connection looking un-synced.
  let deprecatedHit = false
  server.use(
    http.get('https://api.pluggy.test/transactions', () => {
      deprecatedHit = true
      return HttpResponse.json(
        { message: 'This endpoint is deprecated. Use GET /v2/transactions', code: 410 },
        { status: 410 },
      )
    }),
  )

  const rows = await client().listTransactions('acc-credit-1')

  expect(deprecatedHit).toBe(false)
  expect(rows.length).toBeGreaterThan(0)
})

it('follows the cursor until it runs out, rather than stopping at the first page', async () => {
  // v2 has no page/pageSize; it returns `next` as a full query string and
  // omits it on the last page.
  server.use(
    http.get('https://api.pluggy.test/v2/transactions', ({ request }) => {
      const after = new URL(request.url).searchParams.get('after')
      if (!after) {
        return HttpResponse.json({
          results: [tx('page1-a'), tx('page1-b')],
          next: '?accountId=acc-credit-1&after=CURSOR2',
        })
      }
      return HttpResponse.json({ results: [tx('page2-a')], next: null })
    }),
  )

  const rows = await client().listTransactions('acc-credit-1')

  expect(rows.map((r) => r.id)).toEqual(['page1-a', 'page1-b', 'page2-a'])
})

it('rejects a page-count that would loop forever', async () => {
  server.use(
    http.get('https://api.pluggy.test/v2/transactions', () =>
      // Always hands back another cursor: without a cap this never terminates.
      HttpResponse.json({ results: [tx('endless')], next: '?accountId=acc&after=MORE' }),
    ),
  )

  await expect(client().listTransactions('acc-credit-1')).rejects.toThrow(/PLUGGY_TOO_MANY_PAGES/)
})

// --- foreign currency --------------------------------------------------------

it('uses the account-currency amount for a foreign-currency transaction', () => {
  // Real data: a USD purchase carries the USD figure in `amount` and the BRL
  // figure in `amountInAccountCurrency`. Using `amount` understates the spend.
  const mapped = mapTransaction(
    {
      id: 'tx-usd',
      accountId: 'acc-credit-1',
      description: 'AWS',
      amount: 31.89,
      amountInAccountCurrency: 171.25,
      currencyCode: 'USD',
      date: '2026-08-20T03:00:00.000Z',
      type: 'DEBIT',
    },
    'internal-account-id',
  )

  expect(mapped.amountCents).toBe(17125)
})

it('uses amount when the transaction is already in the account currency', () => {
  const mapped = mapTransaction(
    {
      id: 'tx-brl',
      accountId: 'acc-credit-1',
      description: 'ZAFFARI',
      amount: 284.9,
      amountInAccountCurrency: null,
      currencyCode: 'BRL',
      date: '2026-08-20T03:00:00.000Z',
      type: 'DEBIT',
    },
    'internal-account-id',
  )

  expect(mapped.amountCents).toBe(28490)
})

// --- dates, against the shape real data actually uses -------------------------

it('buckets a Sao Paulo midnight-padded date to that calendar day', () => {
  // Verified against a live payload: Pluggy pads to LOCAL midnight expressed
  // in UTC (03:00Z), not UTC midnight.
  expect(toSaoPauloDate('2027-07-15T03:00:00.000Z')).toBe('2027-07-15')
})

it('still converts a genuine late-night instant to the previous day', () => {
  expect(toSaoPauloDate('2026-08-01T02:30:00.000Z')).toBe('2026-07-31')
})

it('treats exact UTC midnight as the instant it is', () => {
  // 00:00Z is 21:00 the previous day in Sao Paulo. Real payloads never use
  // this spelling for a calendar date -- they use 03:00Z -- so converting is
  // the honest reading.
  expect(toSaoPauloDate('2026-08-01T00:00:00.000Z')).toBe('2026-07-31')
})

function tx(id: string) {
  return {
    id,
    accountId: 'acc-credit-1',
    description: 'SOMETHING',
    descriptionRaw: null,
    amount: 10,
    amountInAccountCurrency: null,
    currencyCode: 'BRL',
    date: '2026-08-20T03:00:00.000Z',
    type: 'DEBIT',
    category: null,
    merchant: null,
    creditCardMetadata: null,
  }
}

beforeAll(() => undefined)
afterAll(() => undefined)
afterEach(() => undefined)
