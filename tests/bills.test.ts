import { eq } from 'drizzle-orm'
import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listAccounts } from '@/lib/db/connections'
import { createHousehold } from '@/lib/db/households'
import { bills } from '@/lib/db/schema'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { syncConnection } from '@/lib/sync/transactions'
import { getFaturasView } from '@/lib/views/faturas'
import { resetDb, testDb } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'
import { insertTransaction } from './helpers/transactions'

startPluggyServer()

beforeEach(resetDb)

function pluggy() {
  return createPluggyClient({
    apiUrl: 'https://api.pluggy.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  })
}

async function seed() {
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
  return { db, householdId, connectionId }
}

it('stores the authoritative faturas from Pluggy, in centavos, keyed to the pay month', async () => {
  const { db, householdId, connectionId } = await seed()

  await syncConnection(db, pluggy(), connectionId)

  const rows = await db.select().from(bills)
  // Two faturas in the fixture, both on the credit account; the bank account
  // has none.
  expect(rows).toHaveLength(2)

  const aug = rows.find((b) => b.pluggyBillId === 'bill-aug')!
  expect(aug.totalAmountCents).toBe(446627)
  expect(aug.minimumAmountCents).toBe(44662)
  expect(aug.dueDate).toBe('2026-08-10')
  expect(aug.closingDate).toBe('2026-08-03')
  // Filed under the month it is PAID, first-of-month -- the same key the
  // budgeting screens bucket transactions under.
  expect(aug.period).toBe('2026-08-01')

  // Scoped to the household's own accounts.
  const [account] = (await listAccounts(db, householdId)).filter((a) => a.type === 'CREDIT')
  expect(aug.accountId).toBe(account.id)
})

it('re-syncing does not duplicate a fatura', async () => {
  const { db, connectionId } = await seed()
  await syncConnection(db, pluggy(), connectionId)
  await syncConnection(db, pluggy(), connectionId)
  expect(await db.select().from(bills)).toHaveLength(2)
})

it('faturas view: authoritative bill for closed cycles, provisional estimate for the open one', async () => {
  const { db, householdId, connectionId } = await seed()
  await syncConnection(db, pluggy(), connectionId)

  const [card] = (await listAccounts(db, householdId)).filter((a) => a.type === 'CREDIT')
  // A charge in the still-open September cycle, which has no bill.
  await insertTransaction(db, card.id, {
    description: 'PADARIA SETEMBRO',
    amountCents: 12345,
    date: '2026-09-05',
  })

  const view = await getFaturasView(db, householdId, { now: new Date('2026-09-15T12:00:00.000Z') })
  expect(view.currentPeriod).toBe('2026-09')

  const faturas = view.cards.find((c) => c.accountId === card.id)!
  const byPeriod = new Map(faturas.rows.map((r) => [r.period, r]))

  // Closed cycle -> the bank's number, to the centavo.
  expect(byPeriod.get('2026-08')).toMatchObject({ source: 'BILL', amountCents: 446627 })
  // Open cycle -> a provisional estimate from transactions, no bill.
  expect(byPeriod.get('2026-09')).toMatchObject({ source: 'ESTIMATE', amountCents: 12345 })
})
