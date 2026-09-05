import { z } from 'zod'
import {
  pluggyTransactionSchema,
  type PluggyAccount,
  type PluggyConfig,
  type PluggyItem,
  type PluggyTransaction,
} from './types'

/**
 * 500 transactions per page, so this covers 50k per account per sync -- far
 * beyond a household's real volume. It exists so a server that keeps handing
 * back a cursor cannot spin forever.
 */
const MAX_TRANSACTION_PAGES = 100

export type PluggyClient = {
  createConnectToken(itemId?: string): Promise<string>
  getItem(itemId: string): Promise<PluggyItem>
  /**
   * Asks Pluggy to re-fetch this item from the institution now, rather than
   * waiting for the plan's automatic cadence. The call returns as soon as the
   * refresh is accepted -- the item goes to UPDATING and the fresh data arrives
   * later via the `item/updated` webhook -- so it is a trigger, not a fetch.
   */
  updateItem(itemId: string): Promise<PluggyItem>
  listAccounts(itemId: string): Promise<PluggyAccount[]>
  /**
   * Every transaction for the account. v2 has no transaction-date filter, so
   * a window cannot be requested server-side; the idempotent upsert makes
   * re-reading the full history safe.
   */
  listTransactions(accountId: string): Promise<PluggyTransaction[]>
}

/**
 * A 2xx is not a promise of JSON. A proxy error page, a truncated body or an
 * empty one all reach response.json() as a bare SyntaxError ("unexpected end
 * of data") that names neither Pluggy nor the request that failed -- so the
 * caller cannot tell it apart from a bug in its own code, and no route can map
 * it to something worth reading. Parsing through here keeps every failure
 * inside the PLUGGY_* vocabulary the callers already understand.
 */
async function parseJson<T>(response: Response, path: string): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`PLUGGY_INVALID_RESPONSE:${response.status}:${path}`)
  }
}

export function createPluggyClient(config: PluggyConfig): PluggyClient {
  let apiKey: string | undefined

  async function authenticate(): Promise<string> {
    if (apiKey) return apiKey
    const response = await fetch(`${config.apiUrl}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret }),
    })
    if (!response.ok) throw new Error('PLUGGY_AUTH_FAILED')
    const body = await parseJson<{ apiKey: string }>(response, '/auth')
    apiKey = body.apiKey
    return apiKey
  }

  async function request<T>(path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
    const key = await authenticate()
    const response = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: { ...init.headers, 'content-type': 'application/json', 'X-API-KEY': key },
    })
    if (response.status === 401 || response.status === 403) {
      if (isRetry) throw new Error('PLUGGY_AUTH_FAILED')
      apiKey = undefined
      return request<T>(path, init, true)
    }
    if (!response.ok) throw new Error(`PLUGGY_REQUEST_FAILED:${response.status}:${path}`)
    return parseJson<T>(response, path)
  }

  return {
    async createConnectToken(itemId) {
      const body = await request<{ accessToken: string }>('/connect_token', {
        method: 'POST',
        body: JSON.stringify(itemId ? { itemId } : {}),
      })
      return body.accessToken
    },

    getItem: (itemId) => request<PluggyItem>(`/items/${itemId}`),

    updateItem: (itemId) =>
      request<PluggyItem>(`/items/${itemId}`, {
        method: 'PATCH',
        // An empty body re-runs the stored connection. Credentials are never
        // held here: an MFA connector that needs re-consent is refreshed
        // through the Connect widget's reconnect flow, not this call.
        body: JSON.stringify({}),
      }),

    async listAccounts(itemId) {
      const body = await request<{ results: PluggyAccount[] }>(`/accounts?itemId=${itemId}`)
      return body.results
    },

    async listTransactions(accountId) {
      const results: PluggyTransaction[] = []
      // v2 returns `next` as a complete query string and omits it on the last
      // page. There is no page/pageSize, and no transaction-date filter.
      let query: string | null = `?accountId=${encodeURIComponent(accountId)}`
      let pages = 0

      while (query) {
        if (++pages > MAX_TRANSACTION_PAGES) {
          throw new Error(`PLUGGY_TOO_MANY_PAGES:${accountId}:${pages}`)
        }

        const body: { results: unknown; next?: unknown } = await request(
          `/v2/transactions${query}`,
        )

        const parsed = z.array(pluggyTransactionSchema).safeParse(body.results)
        if (!parsed.success) {
          const detail = parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')
          throw new Error(`PLUGGY_INVALID_TRANSACTION:${accountId}:${detail}`)
        }
        results.push(...parsed.data)

        // Anything other than a usable cursor ends the walk. A non-string
        // `next` is not a page we can fetch, so treating it as the end is the
        // only honest reading — and the page cap above bounds the other way.
        query = typeof body.next === 'string' && body.next.length > 0 ? body.next : null
      }

      return results
    },
  }
}
