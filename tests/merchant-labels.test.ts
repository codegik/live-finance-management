import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import {
  clearMerchantLabel,
  listMerchantLabels,
  resolveLabel,
  setMerchantLabel,
} from '@/lib/db/merchant-labels'
import { connections } from '@/lib/db/schema'
import { getLedgerView } from '@/lib/views/ledger'
import { getMonthView } from '@/lib/views/month'
import { resetDb, testDb } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(resetDb)

const NOW = new Date('2026-08-25T12:00:00.000Z')

/** A household with one card and no Pluggy round-trip -- labels are a pure
 *  presentation concern, so the transactions are inserted straight in. */
async function seedHousehold() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution: 'Nubank',
    })
    .returning({ id: connections.id })
  const cardId = await seedAccount(db, connection.id, { type: 'CREDIT' })
  return { db, householdId, cardId }
}

// --- the pure matcher ------------------------------------------------------

it('resolveLabel matches like a rule: EXACT and CONTAINS, most specific first', () => {
  // Ordered as listMerchantLabels returns them: EXACT before CONTAINS, which is
  // the precedence resolveLabel relies on (first match wins).
  const labels = [
    { matchType: 'EXACT' as const, pattern: 'GADERMATOLOGIA PORTO', label: 'CCAA Porto' },
    { matchType: 'CONTAINS' as const, pattern: 'GADERMATOLOGIA', label: 'CCAA' },
  ]

  // CONTAINS catches every instalment descriptor, whatever the branch noise.
  expect(resolveLabel(labels, 'GADERMATOLOGIA SUL')).toBe('CCAA')
  // EXACT wins over the broad CONTAINS on the descriptor it names exactly.
  expect(resolveLabel(labels, 'GADERMATOLOGIA PORTO')).toBe('CCAA Porto')
  // No match, and a null merchant, both fall through to no label.
  expect(resolveLabel(labels, 'ZAFFARI')).toBeNull()
  expect(resolveLabel(labels, null)).toBeNull()
})

// --- the db round-trip -----------------------------------------------------

it('set normalizes the pattern, upserts in place, and clear removes it', async () => {
  const { db, householdId } = await seedHousehold()

  // Typed with accents and lower case -- normalizeMerchant folds it to the
  // stored form, so what the household types matches what the bank sent.
  const first = await setMerchantLabel(db, householdId, {
    matchType: 'CONTAINS',
    pattern: 'GaDermatologia',
    label: 'CCAA',
  })
  expect(first.ok).toBe(true)

  let labels = await listMerchantLabels(db, householdId)
  expect(labels).toEqual([{ matchType: 'CONTAINS', pattern: 'GADERMATOLOGIA', label: 'CCAA' }])

  // Re-typing the same (matchType, pattern) updates the name, not stacks a row.
  await setMerchantLabel(db, householdId, {
    matchType: 'CONTAINS',
    pattern: 'GADERMATOLOGIA',
    label: 'Dermato',
  })
  labels = await listMerchantLabels(db, householdId)
  expect(labels).toHaveLength(1)
  expect(labels[0].label).toBe('Dermato')

  // A pattern with nothing to match on cannot be stored.
  expect((await setMerchantLabel(db, householdId, { matchType: 'EXACT', pattern: '***', label: 'x' })).ok).toBe(false)
  expect((await setMerchantLabel(db, householdId, { matchType: 'CONTAINS', pattern: 'X', label: '  ' })).ok).toBe(false)

  await clearMerchantLabel(db, householdId, { matchType: 'CONTAINS', pattern: 'gadermatologia' })
  expect(await listMerchantLabels(db, householdId)).toHaveLength(0)
})

// --- through the views -----------------------------------------------------

it('one CONTAINS label renames every instalment on the ledger and dashboard, past and new', async () => {
  const { db, householdId, cardId } = await seedHousehold()

  // Two instalments of the same merchant -- different suffixes, one normalized
  // merchant. A dashboard-visible SPEND category is not needed for the ledger,
  // which lists every SPEND row.
  await insertTransaction(db, cardId, {
    description: 'GaDermatologiaPORT 03/10',
    amountCents: 45500,
    date: '2026-08-15',
  })
  await insertTransaction(db, cardId, {
    description: 'GaDermatologiaPORT 04/10',
    amountCents: 45500,
    date: '2026-08-20',
  })

  await setMerchantLabel(db, householdId, {
    matchType: 'CONTAINS',
    pattern: 'GADERMATOLOGIA',
    label: 'CCAA',
  })

  const ledger = await getLedgerView(db, householdId, { now: NOW })
  const items = ledger.days.flatMap((d) => d.items)
  const derma = items.filter((i) => i.merchantNormalized?.includes('GADERMATOLOGIA'))
  expect(derma).toHaveLength(2)
  // The label shows in place of the descriptor, and the descriptor is retained.
  for (const item of derma) {
    expect(item.label).toBe('CCAA')
    expect(item.description).toContain('GaDermatologia')
  }

  // A row the "future sync" brings in later is matched by the same label with
  // no further action.
  await insertTransaction(db, cardId, {
    description: 'GaDermatologiaPORT 05/10',
    amountCents: 45500,
    date: '2026-08-22',
  })
  const after = await getLedgerView(db, householdId, { now: NOW })
  const labels = after.days.flatMap((d) => d.items).filter((i) => i.label === 'CCAA')
  expect(labels).toHaveLength(3)

  // And the dashboard's month detail carries the same label. These rows are
  // uncategorized, so they sit in that bucket rather than a drawn category row.
  const month = await getMonthView(db, householdId, '2026-08', { now: NOW })
  const monthDerma = month.uncategorizedDetail.transactions.filter((t) =>
    t.merchantNormalized?.includes('GADERMATOLOGIA'),
  )
  expect(monthDerma.length).toBeGreaterThan(0)
  for (const t of monthDerma) expect(t.label).toBe('CCAA')
})
