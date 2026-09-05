import { beforeEach, expect, it } from 'vitest'
import { parseBrlToCents } from '@/app/(app)/faturas/state'
import { hashPassword } from '@/lib/auth/password'
import { listAccounts } from '@/lib/db/connections'
import { clearFaturaOverride, setFaturaOverride } from '@/lib/db/fatura-overrides'
import { createHousehold } from '@/lib/db/households'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { syncConnection } from '@/lib/sync/transactions'
import { getFaturasView, getPendingFaturaLines } from '@/lib/views/faturas'
import { getMonthView } from '@/lib/views/month'
import { resetDb, testDb } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'
import { insertTransaction } from './helpers/transactions'

startPluggyServer()
beforeEach(resetDb)

const NOW = new Date('2026-09-15T12:00:00.000Z')

function pluggy() {
  return createPluggyClient({
    apiUrl: 'https://api.pluggy.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  })
}

async function seedSynced() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const { connectionId } = await attachConnection(db, pluggy(), {
    householdId,
    ownerUserId: userId,
    itemId: 'item-nubank-1',
  })
  await syncConnection(db, pluggy(), connectionId)
  const [card] = (await listAccounts(db, householdId)).filter((a) => a.type === 'CREDIT')
  // A charge in the open September cycle: the estimate the override sits above.
  await insertTransaction(db, card.id, {
    description: 'PADARIA SETEMBRO',
    amountCents: 12345,
    date: '2026-09-05',
  })
  return { db, householdId, card }
}

// --- the pure parser -------------------------------------------------------

it('parses pt-BR and plain money strings to centavos', () => {
  expect(parseBrlToCents('30.772,47')).toBe(3077247)
  expect(parseBrlToCents('30772,47')).toBe(3077247)
  expect(parseBrlToCents('30772.47')).toBe(3077247)
  expect(parseBrlToCents('500')).toBe(50000)
  expect(parseBrlToCents('  1.234,50 ')).toBe(123450)
  expect(parseBrlToCents('')).toBeNull()
  expect(parseBrlToCents('abc')).toBeNull()
  expect(parseBrlToCents('-10')).toBeNull()
})

// --- the view --------------------------------------------------------------

it('shows an informed fatura as OVERRIDE, carrying the estimate it sits above', async () => {
  const { db, householdId, card } = await seedSynced()
  await setFaturaOverride(db, householdId, card.id, '2026-09-01', 50000)

  const view = await getFaturasView(db, householdId, { now: NOW })
  const row = view.cards
    .find((c) => c.accountId === card.id)!
    .rows.find((r) => r.period === '2026-09')!

  expect(row).toMatchObject({ source: 'OVERRIDE', amountCents: 50000, estimateCents: 12345 })
})

it('a published bill wins over an override for the same period', async () => {
  const { db, householdId, card } = await seedSynced()
  // The fixture has a real August bill; overriding August must not displace it.
  await setFaturaOverride(db, householdId, card.id, '2026-08-01', 999999)

  const view = await getFaturasView(db, householdId, { now: NOW })
  const aug = view.cards
    .find((c) => c.accountId === card.id)!
    .rows.find((r) => r.period === '2026-08')!

  expect(aug).toMatchObject({ source: 'BILL', amountCents: 446627 })
})

// --- the dashboard integration --------------------------------------------

it('surfaces the override gap as pending spend and folds it into the month total', async () => {
  const { db, householdId, card } = await seedSynced()

  const before = await getMonthView(db, householdId, '2026-09', { now: NOW })
  await setFaturaOverride(db, householdId, card.id, '2026-09-01', 50000)
  const after = await getMonthView(db, householdId, '2026-09', { now: NOW })

  // Estimate 12345, informed 50000 -> 37655 on the way.
  expect(after.pendingFaturaCents).toBe(37655)
  expect(after.pendingFaturaLines).toHaveLength(1)
  expect(after.pendingFaturaLines[0]).toMatchObject({ diffCents: 37655, overrideCents: 50000 })
  // The headline expense rises by exactly the gap.
  expect(after.expenseCents - before.expenseCents).toBe(37655)
})

it('getPendingFaturaLines ignores an override once its bill lands, and clearing removes it', async () => {
  const { db, householdId, card } = await seedSynced()

  await setFaturaOverride(db, householdId, card.id, '2026-09-01', 50000)
  expect(await getPendingFaturaLines(db, householdId, '2026-09')).toHaveLength(1)

  // August already has a bill -> an override there yields nothing pending.
  await setFaturaOverride(db, householdId, card.id, '2026-08-01', 999999)
  expect(await getPendingFaturaLines(db, householdId, '2026-08')).toHaveLength(0)

  await clearFaturaOverride(db, householdId, card.id, '2026-09-01')
  expect(await getPendingFaturaLines(db, householdId, '2026-09')).toHaveLength(0)
})

it('does not let one household override another household card', async () => {
  const { db, card } = await seedSynced()
  const other = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })

  const { ok } = await setFaturaOverride(db, other.householdId, card.id, '2026-09-01', 50000)
  expect(ok).toBe(false)
  expect(await getPendingFaturaLines(db, other.householdId, '2026-09')).toHaveLength(0)
})
