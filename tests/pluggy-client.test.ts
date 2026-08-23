import { http, HttpResponse } from 'msw'
import { expect, it } from 'vitest'
import { createPluggyClient } from '@/lib/pluggy/client'
import { createPluggyServer, startPluggyServer } from './helpers/pluggy-server'

const server = startPluggyServer()


function client() {
  return createPluggyClient({
    apiUrl: 'https://api.pluggy.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  })
}

it('exchanges credentials for an api key and returns a connect token', async () => {
  const token = await client().createConnectToken()

  expect(token).toBe('connect-token-abc')
})

it('fetches the item, its accounts, and its transactions', async () => {
  const pluggy = client()

  const item = await pluggy.getItem('item-nubank-1')
  const accounts = await pluggy.listAccounts('item-nubank-1')
  const transactions = await pluggy.listTransactions('acc-credit-1', '2026-05-24')

  expect(item.status).toBe('UPDATED')
  expect(item.connector.name).toBe('Nubank')
  expect(accounts.map((a) => a.type).sort()).toEqual(['BANK', 'CREDIT'])
  // tx-1, tx-late-night, tx-refund and tx-date-only all sit on acc-credit-1.
  expect(transactions).toHaveLength(4)
  expect(transactions[0].description).toBe('ZAFFARI PORTO ALEG *0421')
})

it('surfaces a pluggy failure as an error rather than empty data', async () => {
  const pluggy = createPluggyClient({
    apiUrl: 'https://api.pluggy.test',
    clientId: 'bad',
    clientSecret: 'bad',
  })

  await expect(pluggy.getItem('item-nubank-1')).rejects.toThrow('PLUGGY_AUTH_FAILED')
})

// This test constructs a SECOND setupServer instance via createPluggyServer([...]) rather
// than using server.use() on the module-level server. That is deliberate: server.use()
// handlers always take precedence over the base handlers regardless of array order, so
// routing this through server.use() would never exercise the ...overrides-ordering defect
// that was fixed in the server factory itself. To avoid two concurrently-listening MSW
// interceptors contending over the same global fetch/http patch, the module-level server
// is closed for the duration of this test and re-listened afterwards, so only one
// setupServer instance is ever enabled at a time.
it('allows constructor overrides to take precedence over default handlers', async () => {
  // createPluggyServer, not startPluggyServer: hooks can only be registered
  // during collection, and this runs inside a test.
  const overriddenServer = createPluggyServer([
    http.get('https://api.pluggy.test/items/:itemId', () =>
      HttpResponse.json({
        id: 'override-item',
        status: 'UPDATING',
        connector: { id: 1, name: 'Override' },
        lastUpdatedAt: null,
      }),
    ),
  ])

  server.close()
  overriddenServer.listen({ onUnhandledRequest: 'error' })

  try {
    const pluggy = client()
    const item = await pluggy.getItem('item-nubank-1')
    expect(item.connector.name).toBe('Override')
  } finally {
    overriddenServer.close()
    server.listen({ onUnhandledRequest: 'error' })
  }
})

it('retries auth on 401 and re-authenticates', async () => {
  let requestCount = 0
  server.use(
    http.get('https://api.pluggy.test/items/:itemId', () => {
      requestCount++
      if (requestCount === 1) {
        return new HttpResponse(null, { status: 401 })
      }
      return HttpResponse.json({
        id: 'item-nubank-1',
        status: 'UPDATED',
        connector: { id: 212, name: 'Nubank' },
        lastUpdatedAt: '2026-08-22T09:00:00.000Z',
      })
    }),
  )

  const pluggy = client()
  const item = await pluggy.getItem('item-nubank-1')
  expect(item.connector.name).toBe('Nubank')
  expect(requestCount).toBe(2)
})

it('throws PLUGGY_AUTH_FAILED on persistent 401 after retry', async () => {
  server.use(
    http.get('https://api.pluggy.test/items/:itemId', () => new HttpResponse(null, { status: 401 })),
  )

  const pluggy = client()
  await expect(pluggy.getItem('item-nubank-1')).rejects.toThrow('PLUGGY_AUTH_FAILED')
})

it('throws rather than silently returning page 1 when totalPages is missing', async () => {
  server.use(
    http.get('https://api.pluggy.test/transactions', () =>
      HttpResponse.json({
        page: 1,
        results: [
          {
            id: 'tx-1',
            accountId: 'acc-credit-1',
            description: 'ZAFFARI PORTO ALEG *0421',
            amount: 284.9,
            date: '2026-08-20T14:02:00.000Z',
            type: 'DEBIT',
          },
        ],
      }),
    ),
  )

  // Stopping after page 1 would under-report spend with no error at all --
  // a ledger that looks healthy and is wrong.
  await expect(client().listTransactions('acc-credit-1', '2026-05-24')).rejects.toThrow(
    /PLUGGY_INVALID_PAGINATION/,
  )
})

it('refuses an implausible totalPages instead of looping forever', async () => {
  server.use(
    http.get('https://api.pluggy.test/transactions', () =>
      HttpResponse.json({ page: 1, totalPages: 100000, results: [] }),
    ),
  )

  await expect(client().listTransactions('acc-credit-1', '2026-05-24')).rejects.toThrow(
    /PLUGGY_TOO_MANY_PAGES/,
  )
})

it('follows every page when totalPages is present', async () => {
  const seen: string[] = []
  server.use(
    http.get('https://api.pluggy.test/transactions', ({ request }) => {
      const page = new URL(request.url).searchParams.get('page')!
      seen.push(page)
      return HttpResponse.json({
        page: Number(page),
        totalPages: 2,
        results: [
          {
            id: `tx-page-${page}`,
            accountId: 'acc-credit-1',
            description: 'PAGINATED',
            amount: 10,
            date: '2026-08-20T14:02:00.000Z',
            type: 'DEBIT',
          },
        ],
      })
    }),
  )

  const transactions = await client().listTransactions('acc-credit-1', '2026-05-24')

  expect(seen).toEqual(['1', '2'])
  expect(transactions.map((t) => t.id)).toEqual(['tx-page-1', 'tx-page-2'])
})
