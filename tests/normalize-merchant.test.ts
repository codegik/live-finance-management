import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listTransactions } from '@/lib/db/transactions'
import { createHousehold } from '@/lib/db/households'
import { normalizeMerchant } from '@/lib/domain/categorize'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { syncConnection } from '@/lib/sync/transactions'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'

startPluggyServer()

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

it('uppercases, deaccents and collapses whitespace', () => {
  expect(normalizeMerchant('  Padaria   São João ')).toBe('PADARIA SAO JOAO')
})

it('drops asterisk-delimited noise and everything after it', () => {
  expect(normalizeMerchant('ZAFFARI PORTO ALEG *0421')).toBe('ZAFFARI PORTO ALEG')
  expect(normalizeMerchant('IFOOD *PEDIDO')).toBe('IFOOD')
})

it('strips an installment suffix in both spellings', () => {
  expect(normalizeMerchant('ZAFFARI CENTRO PARC 03/12')).toBe('ZAFFARI CENTRO')
  expect(normalizeMerchant('ZAFFARI CENTRO 03/12')).toBe('ZAFFARI CENTRO')
})

it('strips a trailing store number', () => {
  expect(normalizeMerchant('POSTO IPIRANGA 4471')).toBe('POSTO IPIRANGA')
})

it('keeps branch fragments, because guessing at place names would merge real merchants', () => {
  // Deliberate: reducing these to ZAFFARI needs a gazetteer of Brazilian
  // place names. A CONTAINS rule unifies them instead (Task 5).
  expect(normalizeMerchant('ZAFFARI PORTO ALEG')).not.toBe(normalizeMerchant('ZAFFARI CENTRO'))
})

it('returns null when there is nothing left to match on', () => {
  expect(normalizeMerchant(null)).toBeNull()
  expect(normalizeMerchant('   ')).toBeNull()
  expect(normalizeMerchant('*0421')).toBeNull()
})

it('prefers the Pluggy merchant name over the noisier descriptor at ingest', async () => {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const pluggy = createPluggyClient({
    apiUrl: 'https://api.pluggy.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  })
  const { connectionId } = await attachConnection(db, pluggy, {
    householdId,
    ownerUserId: userId,
    itemId: 'item-nubank-1',
  })
  await syncConnection(db, pluggy, connectionId)

  const rows = await listTransactions(db, householdId)

  // tx-1's description is 'ZAFFARI PORTO ALEG *0421' but its payload carries
  // merchant.name 'Zaffari'. Preferring the name is what collapses branch
  // variants for free wherever Pluggy supplies it.
  const zaffari = rows.find((r) => r.pluggyTransactionId === 'tx-1')!
  expect(zaffari.merchantNormalized).toBe('ZAFFARI')

  // tx-late-night has no merchant object, so it falls back to the descriptor.
  const ifood = rows.find((r) => r.pluggyTransactionId === 'tx-late-night')!
  expect(ifood.merchantNormalized).toBe('IFOOD')
})
