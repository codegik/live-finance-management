import { expect, it } from 'vitest'
import type { ConnectionDetail } from '@/lib/db/connections'
import { bankOptions } from '@/lib/views/bank-options'

function connection(over: Partial<ConnectionDetail> & { id: string }): ConnectionDetail {
  return {
    id: over.id,
    pluggyItemId: `item-${over.id}`,
    institution: over.institution ?? 'MeuPluggy',
    ownerName: over.ownerName ?? 'Inacio',
    status: over.status ?? 'UPDATED',
    lastSyncedAt: over.lastSyncedAt ?? null,
    stale: over.stale ?? null,
    accounts: over.accounts ?? [],
  } as ConnectionDetail
}

it('labels a bank by its account names, not the connector', () => {
  const options = bankOptions([
    connection({
      id: 'c1',
      institution: 'MeuPluggy',
      accounts: [{ name: 'Conta Corrente' }, { name: 'Cartão' }] as ConnectionDetail['accounts'],
    }),
  ])

  expect(options).toEqual([{ id: 'c1', label: 'Conta Corrente, Cartão' }])
})

it('falls back to the institution when a connection has no accounts', () => {
  const options = bankOptions([connection({ id: 'c1', institution: 'Nubank', accounts: [] })])

  expect(options).toEqual([{ id: 'c1', label: 'Nubank' }])
})

it('breaks a duplicate label with an id fragment so options stay distinct', () => {
  const options = bankOptions([
    connection({ id: 'aaaa1111', institution: 'MeuPluggy', accounts: [] }),
    connection({ id: 'bbbb2222', institution: 'MeuPluggy', accounts: [] }),
  ])

  expect(options).toEqual([
    { id: 'aaaa1111', label: 'MeuPluggy' },
    { id: 'bbbb2222', label: 'MeuPluggy (bbbb)' },
  ])
})
