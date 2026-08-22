import { afterAll, beforeAll, expect, it } from 'vitest'
import { createPluggyClient } from '@/lib/pluggy/client'
import { startPluggyServer } from './helpers/pluggy-server'

const server = startPluggyServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

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
  expect(transactions).toHaveLength(3)
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
