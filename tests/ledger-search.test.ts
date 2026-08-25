import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { refreshBudgetRoles } from '@/lib/sync/budget-roles'
import { getLedgerView } from '@/lib/views/ledger'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

async function seedHousehold(name: string, email: string) {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name,
    owner: { email, name, passwordHash: await hashPassword('pw') },
  })
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution: 'Itau',
      status: 'UPDATED',
    })
    .returning({ id: connections.id })
  return { db, householdId, accountId: await seedAccount(db, connection.id) }
}

function descriptions(view: { days: { items: { description: string }[] }[] }): string[] {
  return view.days.flatMap((day) => day.items).map((item) => item.description)
}

it('matches the description regardless of case', async () => {
  const { db, householdId, accountId } = await seedHousehold('Klassmann', 'inacio@example.com')
  await insertTransaction(db, accountId, { description: 'ZAFFARI PORTO ALEG *0421' })
  await insertTransaction(db, accountId, { description: 'POSTO IPIRANGA' })

  const view = await getLedgerView(db, householdId, { search: 'zaffari' })

  expect(descriptions(view)).toEqual(['ZAFFARI PORTO ALEG *0421'])
})

it('matches the normalised merchant, which the description does not spell', async () => {
  const { db, householdId, accountId } = await seedHousehold('Klassmann', 'inacio@example.com')
  // normalizeMerchant strips the accents the card descriptor carries, so
  // merchant_normalized is 'PADARIA SAO JOSE'. Nobody reaches for the dead
  // keys to search their own statement, and ILIKE folds case but never
  // accents -- so matching the description alone would find nothing here.
  await insertTransaction(db, accountId, { description: 'PADARIA SÃO JOSÉ' })
  await insertTransaction(db, accountId, { description: 'POSTO IPIRANGA' })

  const view = await getLedgerView(db, householdId, { search: 'sao jose' })

  expect(descriptions(view)).toEqual(['PADARIA SÃO JOSÉ'])
})

it("treats a typed '%' as a character, not as a wildcard", async () => {
  const { db, householdId, accountId } = await seedHousehold('Klassmann', 'inacio@example.com')
  await insertTransaction(db, accountId, { description: 'DESCONTO 50% LOJA' })
  await insertTransaction(db, accountId, { description: 'POSTO IPIRANGA' })
  await insertTransaction(db, accountId, { description: 'ZAFFARI PORTO ALEG' })

  const view = await getLedgerView(db, householdId, { search: '%' })

  // Unescaped, '%...%' becomes '%%%' and returns the entire statement while
  // looking like a filter -- with every day header still totalling its whole
  // day, so nothing on screen would give the mistake away.
  expect(descriptions(view)).toEqual(['DESCONTO 50% LOJA'])
})

it("treats a typed '_' as a character, not as a single-character wildcard", async () => {
  const { db, householdId, accountId } = await seedHousehold('Klassmann', 'inacio@example.com')
  await insertTransaction(db, accountId, { description: 'PIX_ENVIADO JOAO' })
  await insertTransaction(db, accountId, { description: 'PIXXENVIADO MARIA' })

  const view = await getLedgerView(db, householdId, { search: 'PIX_ENVIADO' })

  expect(descriptions(view)).toEqual(['PIX_ENVIADO JOAO'])
})

it("treats a typed backslash as a character rather than as LIKE's escape", async () => {
  const { db, householdId, accountId } = await seedHousehold('Klassmann', 'inacio@example.com')
  await insertTransaction(db, accountId, { description: 'LOJA A\\B COMERCIO' })
  await insertTransaction(db, accountId, { description: 'LOJA AB COMERCIO' })

  const view = await getLedgerView(db, householdId, { search: 'A\\B' })

  // Without escaping the backslash itself, Postgres reads '\B' as an escaped
  // 'B' and the search would also return 'LOJA AB COMERCIO'.
  expect(descriptions(view)).toEqual(['LOJA A\\B COMERCIO'])
})

it('never reaches another household, however matching the text', async () => {
  const ours = await seedHousehold('Klassmann', 'inacio@example.com')
  const theirs = await seedHousehold('Silva', 'silva@example.com')
  await insertTransaction(ours.db, ours.accountId, { description: 'ZAFFARI NOSSO' })
  await insertTransaction(theirs.db, theirs.accountId, { description: 'ZAFFARI DELES' })

  const view = await getLedgerView(ours.db, ours.householdId, { search: 'zaffari' })

  expect(descriptions(view)).toEqual(['ZAFFARI NOSSO'])
  // And the same guarantee one layer down, where the household filter
  // actually lives -- so a future caller cannot get scoping for free from
  // the view and lose it by querying directly.
  const rows = await listTransactions(theirs.db, theirs.householdId, { search: 'zaffari' })
  expect(rows.map((row) => row.description)).toEqual(['ZAFFARI DELES'])
})

it('totals each day from the matching rows only', async () => {
  const { db, householdId, accountId } = await seedHousehold('Klassmann', 'inacio@example.com')
  await insertTransaction(db, accountId, {
    description: 'ZAFFARI PORTO ALEG',
    amountCents: 12_000,
    date: '2026-08-20',
  })
  await insertTransaction(db, accountId, {
    description: 'POSTO IPIRANGA',
    amountCents: 30_000,
    date: '2026-08-20',
  })

  const all = await getLedgerView(db, householdId)
  const filtered = await getLedgerView(db, householdId, { search: 'zaffari' })

  expect(all.days[0].totalCents).toBe(42_000)
  // A day header still reading R$ 420,00 over a single R$ 120,00 row is a
  // screen that contradicts itself: the reader adds up what they can see and
  // gets a different answer.
  expect(filtered.days[0].totalCents).toBe(12_000)
  expect(filtered.itemCount).toBe(1)
  expect(filtered.totalCents).toBe(12_000)
  expect(filtered.search).toBe('zaffari')
})

it('treats a blank box as no search at all', async () => {
  const { db, householdId, accountId } = await seedHousehold('Klassmann', 'inacio@example.com')
  await insertTransaction(db, accountId, { description: 'ZAFFARI PORTO ALEG' })
  await insertTransaction(db, accountId, { description: 'POSTO IPIRANGA' })

  // '?q=' and '?q=%20' must not become a '%%' pattern -- which would also
  // drop every row whose merchant_normalized is NULL if it were applied to
  // that column alone.
  for (const blank of ['', '   ']) {
    const view = await getLedgerView(db, householdId, { search: blank })
    expect(descriptions(view)).toHaveLength(2)
    expect(view.search).toBeNull()
  }
})

it('searches within the transfers toggle rather than around it', async () => {
  const { db, householdId, accountId } = await seedHousehold('Klassmann', 'inacio@example.com')
  await insertTransaction(db, accountId, {
    description: 'PAGAMENTO FATURA NUBANK',
    amountCents: -100_000,
    pluggyCategory: 'Credit card payment',
  })
  await insertTransaction(db, accountId, { description: 'MERCADO NUBANK LOJA' })
  await refreshBudgetRoles(db, householdId)

  const spendOnly = await getLedgerView(db, householdId, { search: 'nubank' })
  const everything = await getLedgerView(db, householdId, {
    search: 'nubank',
    includeExcluded: true,
  })

  // The two filters compose. A search that quietly ignored the toggle would
  // surface an invoice payment on a screen whose own header says transfers
  // are hidden.
  expect(descriptions(spendOnly)).toEqual(['MERCADO NUBANK LOJA'])
  expect(descriptions(everything)).toHaveLength(2)
})

it('keeps the inbox backlog household-wide while a search narrows the list', async () => {
  const { db, householdId, accountId } = await seedHousehold('Klassmann', 'inacio@example.com')
  // 'Fees' is deliberately unmapped, so both rows land uncategorized.
  await insertTransaction(db, accountId, {
    description: 'TARIFA MANUTENCAO',
    pluggyCategory: 'Fees',
  })
  await insertTransaction(db, accountId, { description: 'ZAFFARI PORTO ALEG', pluggyCategory: 'Fees' })

  const view = await getLedgerView(db, householdId, { search: 'zaffari' })

  // The badge answers "how much is still waiting", a question about the
  // household. Narrowing it would make the backlog appear to shrink as
  // someone typed.
  expect(view.itemCount).toBe(1)
  expect(view.uncategorizedCount).toBe(2)
})
