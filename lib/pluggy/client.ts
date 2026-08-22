import type {
  PluggyAccount,
  PluggyConfig,
  PluggyItem,
  PluggyTransaction,
} from './types'

export type PluggyClient = {
  createConnectToken(itemId?: string): Promise<string>
  getItem(itemId: string): Promise<PluggyItem>
  listAccounts(itemId: string): Promise<PluggyAccount[]>
  listTransactions(accountId: string, from: string): Promise<PluggyTransaction[]>
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

    async listTransactions(accountId, from) {
      const results: PluggyTransaction[] = []
      let page = 1
      let totalPages = 1

      do {
        const body = await request<{ results: PluggyTransaction[]; totalPages: number }>(
          `/transactions?accountId=${accountId}&from=${from}&pageSize=500&page=${page}`,
        )
        results.push(...body.results)
        totalPages = body.totalPages
        page += 1
      } while (page <= totalPages)

      return results
    },
  }
}
