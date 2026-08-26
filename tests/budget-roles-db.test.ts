import { eq } from 'drizzle-orm'
import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { connections, transactions } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { refreshBudgetRoles } from '@/lib/sync/budget-roles'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

async function seedHousehold() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: {
      email: `inacio-${crypto.randomUUID()}@example.com`,
      name: 'Inacio',
      passwordHash: await hashPassword('pw'),
    },
  })
  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: userId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution: 'Nubank',
      status: 'UPDATED',
      lastSyncedAt: new Date(),
    })
    .returning({ id: connections.id })
  const accountId = await seedAccount(db, connection.id)
  return { db, householdId, accountId, connectionId: connection.id }
}

async function roleOf(db: ReturnType<typeof testDb>, householdId: string, id: string) {
  const rows = await listTransactions(db, householdId, { includeExcluded: true })
  return rows.find((r) => r.id === id)!.budgetRole
}

it('assigns each role from the category, and leaves spending alone', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const payment = await insertTransaction(db, accountId, {
    description: 'PAGAMENTO FATURA',
    amountCents: -177_174_79,
    pluggyCategory: 'Credit card payment',
  })
  const salary = await insertTransaction(db, accountId, {
    description: 'SALARIO',
    amountCents: -1_200_000,
    pluggyCategory: 'Salary',
  })
  const groceries = await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    pluggyCategory: 'Groceries',
  })

  const { changed } = await refreshBudgetRoles(db, householdId)

  expect(changed).toBe(2)
  expect(await roleOf(db, householdId, payment)).toBe('TRANSFER')
  expect(await roleOf(db, householdId, salary)).toBe('INCOME')
  expect(await roleOf(db, householdId, groceries)).toBe('SPEND')
})

it('moves a row back to spending when its category stops being an exclusion', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const id = await insertTransaction(db, accountId, {
    description: 'ZAFFARI',
    pluggyCategory: 'Groceries',
  })
  await db.update(transactions).set({ budgetRole: 'INCOME' }).where(eq(transactions.id, id))

  const { changed } = await refreshBudgetRoles(db, householdId)

  expect(changed).toBe(1)
  expect(await roleOf(db, householdId, id)).toBe('SPEND')
})

it('is idempotent, and moves a row back to spending when its category stops being a transfer', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const id = await insertTransaction(db, accountId, {
    description: 'AJUSTE',
    pluggyCategory: 'Transfers',
  })
  expect((await refreshBudgetRoles(db, householdId)).changed).toBe(1)
  expect(await roleOf(db, householdId, id)).toBe('TRANSFER')
  // A second consecutive call has nothing left to change: every row's role
  // already matches its category, so the returned count stays honest.
  expect((await refreshBudgetRoles(db, householdId)).changed).toBe(0)

  await db
    .update(transactions)
    .set({ pluggyCategory: 'Groceries' })
    .where(eq(transactions.id, id))
  const { changed } = await refreshBudgetRoles(db, householdId)

  expect(changed).toBe(1)
  expect(await roleOf(db, householdId, id)).toBe('SPEND')
})

it('re-roles a hand-categorized row too, which recategorize could never do', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const id = await insertTransaction(db, accountId, {
    description: 'PAGAMENTO FATURA',
    pluggyCategory: 'Credit card payment',
  })
  // Whether a row is an invoice payment has nothing to do with who set its
  // category, so this pass has no MANUAL exclusion at all.
  await db.update(transactions).set({ categorySource: 'MANUAL' }).where(eq(transactions.id, id))

  await refreshBudgetRoles(db, householdId)

  expect(await roleOf(db, householdId, id)).toBe('TRANSFER')
})

it('forces BOTH legs of an own-account transfer to TRANSFER', async () => {
  const { db, householdId, connectionId } = await seedHousehold()
  const bankA = await seedAccount(db, connectionId, { type: 'BANK', name: 'Nubank' })
  const bankB = await seedAccount(db, connectionId, { type: 'BANK', name: 'Poupança' })
  // The prod transaction: R$9.425,00 out of one account, into another the same
  // day. Left alone, the debit is SPEND and the credit INCOME -- the same money
  // inflating Despesas and Receita at once.
  const out = await insertTransaction(db, bankA, {
    description: 'Transferência enviada',
    amountCents: 942_500,
    date: '2026-08-06',
  })
  const inc = await insertTransaction(db, bankB, {
    description: 'Transferência recebida',
    amountCents: -942_500,
    date: '2026-08-06',
  })

  await refreshBudgetRoles(db, householdId)

  expect(await roleOf(db, householdId, out)).toBe('TRANSFER')
  expect(await roleOf(db, householdId, inc)).toBe('TRANSFER')
})

it('pairs an own-account transfer even when the debit carries an AUTO category', async () => {
  const { db, householdId, connectionId } = await seedHousehold()
  const bankA = await seedAccount(db, connectionId, { type: 'BANK', name: 'Nubank' })
  const bankB = await seedAccount(db, connectionId, { type: 'BANK', name: 'Poupança' })
  const out = await insertTransaction(db, bankA, {
    description: 'Transferência enviada',
    amountCents: 942_500,
    date: '2026-08-06',
  })
  const inc = await insertTransaction(db, bankB, {
    description: 'Transferência recebida',
    amountCents: -942_500,
    date: '2026-08-06',
  })
  // A merchant rule filed the debit under 'Casa' (the prod case). categorySource
  // RULE -- not MANUAL -- so the fact-based pairing still wins.
  await db
    .update(transactions)
    .set({ categorySource: 'RULE' })
    .where(eq(transactions.id, out))

  await refreshBudgetRoles(db, householdId)

  expect(await roleOf(db, householdId, out)).toBe('TRANSFER')
  expect(await roleOf(db, householdId, inc)).toBe('TRANSFER')
})

it('leaves an own-transfer leg the household MANUALLY filed as a real expense', async () => {
  const { db, householdId, connectionId } = await seedHousehold()
  const bankA = await seedAccount(db, connectionId, { type: 'BANK', name: 'Nubank' })
  const bankB = await seedAccount(db, connectionId, { type: 'BANK', name: 'Poupança' })
  const out = await insertTransaction(db, bankA, {
    description: 'Transferência enviada',
    amountCents: 942_500,
    date: '2026-08-06',
  })
  const inc = await insertTransaction(db, bankB, {
    description: 'Transferência recebida',
    amountCents: -942_500,
    date: '2026-08-06',
  })
  // The household insists the debit is a real expense. A MANUAL filing wins over
  // the pairing, so the debit stays SPEND -- and its now-unpaired credit stays
  // INCOME, both visible.
  await db
    .update(transactions)
    .set({ categorySource: 'MANUAL' })
    .where(eq(transactions.id, out))

  await refreshBudgetRoles(db, householdId)

  expect(await roleOf(db, householdId, out)).toBe('SPEND')
  expect(await roleOf(db, householdId, inc)).toBe('INCOME')
})

it('leaves another household alone', async () => {
  const { db, householdId } = await seedHousehold()
  const other = await seedHousehold()
  await insertTransaction(other.db, other.accountId, {
    description: 'PAGAMENTO FATURA',
    pluggyCategory: 'Credit card payment',
  })

  const { changed } = await refreshBudgetRoles(db, householdId)

  expect(changed).toBe(0)
})
