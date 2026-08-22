import { http, HttpResponse, type RequestHandler } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll } from 'vitest'
import accounts from '../fixtures/pluggy/accounts.json'
import item from '../fixtures/pluggy/item.json'
import transactions from '../fixtures/pluggy/transactions.json'

const BASE = 'https://api.pluggy.test'

/** Builds a Pluggy mock server WITHOUT registering any lifecycle hooks. */
export function createPluggyServer(overrides: RequestHandler[] = []) {
  return setupServer(
    ...overrides,
    http.post(`${BASE}/auth`, async ({ request }) => {
      const body = (await request.json()) as { clientId: string; clientSecret: string }
      if (body.clientId !== 'client-id') return new HttpResponse(null, { status: 403 })
      return HttpResponse.json({ apiKey: 'api-key-xyz' })
    }),
    http.post(`${BASE}/connect_token`, () => HttpResponse.json({ accessToken: 'connect-token-abc' })),
    http.get(`${BASE}/items/:itemId`, () => HttpResponse.json(item)),
    http.get(`${BASE}/accounts`, () => HttpResponse.json(accounts)),
    http.get(`${BASE}/transactions`, ({ request }) => {
      const accountId = new URL(request.url).searchParams.get('accountId')
      const results = accountId
        ? transactions.results.filter((tx) => tx.accountId === accountId)
        : transactions.results
      return HttpResponse.json({ ...transactions, results })
    }),
  )
}

/**
 * Builds the server AND owns its whole lifecycle, resetHandlers() included.
 * Three test files used to omit that reset; it was harmless only because they
 * happened never to call server.use(), so the invariant held by coincidence.
 * Registering the hooks here means no test file can forget.
 *
 * Call this at module scope of a test file (hooks must be registered during
 * collection). Inside a running test, use createPluggyServer() instead.
 */
export function startPluggyServer(overrides: RequestHandler[] = []) {
  const server = createPluggyServer(overrides)

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())

  return server
}
