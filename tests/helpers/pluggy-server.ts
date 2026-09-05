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
    // A forced refresh: real Pluggy accepts the PATCH and flips the item to
    // UPDATING while it re-fetches from the bank. The fixture status is enough
    // for the sync that follows; tests that need the throttle path override this
    // with a 4xx.
    http.patch(`${BASE}/items/:itemId`, () => HttpResponse.json(item)),
    // Real Pluggy scopes /accounts to the requested itemId (the client sends
    // it as a query param); filtering here too matters now that
    // refreshAccounts runs on every sync, not only at connect time, so a
    // connection for one item never picks up another item's fixture accounts.
    http.get(`${BASE}/accounts`, ({ request }) => {
      const itemId = new URL(request.url).searchParams.get('itemId')
      const results = itemId ? accounts.results.filter((a) => a.itemId === itemId) : accounts.results
      return HttpResponse.json({ results })
    }),
    // The v1 /transactions endpoint answers 410 ENDPOINT_DEPRECATED in
    // production. Mirroring that here means a regression back to it fails
    // loudly in the suite instead of only against the real API.
    http.get(`${BASE}/transactions`, () =>
      HttpResponse.json(
        {
          message: 'This endpoint is deprecated. Use GET /v2/transactions with cursor pagination instead.',
          code: 410,
          codeDescription: 'ENDPOINT_DEPRECATED',
        },
        { status: 410 },
      ),
    ),
    // v2: cursor pagination, `next` omitted on the last page. The fixture is
    // small enough to be a single page.
    http.get(`${BASE}/v2/transactions`, ({ request }) => {
      const accountId = new URL(request.url).searchParams.get('accountId')
      const results = accountId
        ? transactions.results.filter((tx) => tx.accountId === accountId)
        : transactions.results
      return HttpResponse.json({ results, next: null })
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
