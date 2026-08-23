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
  listAccounts(itemId: string): Promise<PluggyAccount[]>
  /**
   * Every transaction for the account. v2 has no transaction-date filter, so
   * a window cannot be requested server-side; the idempotent upsert makes
   * re-reading the full history safe.
   */
  listTransactions(accountId: string): Promise<PluggyTransaction[]>
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
    const body = (await response.json()) as { apiKey: string }
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
    return (await response.json()) as T
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
