import { http, HttpResponse, type RequestHandler } from 'msw'
import { setupServer } from 'msw/node'
import accounts from '../fixtures/pluggy/accounts.json'
import item from '../fixtures/pluggy/item.json'
import transactions from '../fixtures/pluggy/transactions.json'

const BASE = 'https://api.pluggy.test'

export function startPluggyServer(overrides: RequestHandler[] = []) {
  return setupServer(
    http.post(`${BASE}/auth`, async ({ request }) => {
      const body = (await request.json()) as { clientId: string; clientSecret: string }
      if (body.clientId !== 'client-id') return new HttpResponse(null, { status: 403 })
      return HttpResponse.json({ apiKey: 'api-key-xyz' })
    }),
    http.post(`${BASE}/connect_token`, () => HttpResponse.json({ accessToken: 'connect-token-abc' })),
    http.get(`${BASE}/items/:itemId`, () => HttpResponse.json(item)),
    http.get(`${BASE}/accounts`, () => HttpResponse.json(accounts)),
    http.get(`${BASE}/transactions`, () => HttpResponse.json(transactions)),
    ...overrides,
  )
}
