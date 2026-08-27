import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { previewRuleMatches } from '@/lib/db/rules'
import { connections } from '@/lib/db/schema'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { insertTransaction, seedAccount } from './helpers/transactions'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

async function seedBank(name: string, email: string, institution = 'Itau') {
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
      institution,
      status: 'UPDATED',
    })
    .returning({ id: connections.id })
  return { db, householdId, connectionId: connection.id, accountId: await seedAccount(db, connection.id) }
}

function descriptions(result: { items: { description: string }[] }): string[] {
  return result.items.map((item) => item.description)
}

it('previews the branches a CONTAINS rule would catch', async () => {
  const { db, householdId, accountId } = await seedBank('Klassmann', 'inacio@example.com')
  await insertTransaction(db, accountId, { description: 'ZAFFARI PORTO ALEG *0421' })
  await insertTransaction(db, accountId, { description: 'ZAFFARI CENTRO 55' })
  await insertTransaction(db, accountId, { description: 'POSTO IPIRANGA' })

  const result = await previewRuleMatches(db, householdId, {
    matchType: 'CONTAINS',
    pattern: 'zaffari',
  })

  expect(result.total).toBe(2)
  expect(descriptions(result).sort()).toEqual(['ZAFFARI CENTRO 55', 'ZAFFARI PORTO ALEG *0421'])
})

it('previews only the one merchant an EXACT rule names', async () => {
  const { db, householdId, accountId } = await seedBank('Klassmann', 'inacio@example.com')
  await insertTransaction(db, accountId, { description: 'ZAFFARI PORTO ALEG' })
  await insertTransaction(db, accountId, { description: 'ZAFFARI CENTRO' })

  const result = await previewRuleMatches(db, householdId, {
    matchType: 'EXACT',
    pattern: 'ZAFFARI PORTO ALEG',
  })

  expect(descriptions(result)).toEqual(['ZAFFARI PORTO ALEG'])
})

it('narrows the preview to one bank when scoped', async () => {
  const bank = await seedBank('Klassmann', 'inacio@example.com', 'Itau')
  await insertTransaction(bank.db, bank.accountId, { description: 'ZAFFARI PORTO ALEG' })
  // A second bank on the same household with the same merchant.
  const [second] = await bank.db
    .insert(connections)
    .values({
      householdId: bank.householdId,
      ownerUserId: (await bank.db.select().from(connections).limit(1))[0].ownerUserId,
      pluggyItemId: `item-${crypto.randomUUID()}`,
      institution: 'Nubank',
      status: 'UPDATED',
    })
    .returning({ id: connections.id })
  const secondAccount = await seedAccount(bank.db, second.id)
  await insertTransaction(bank.db, secondAccount, { description: 'ZAFFARI PORTO ALEG' })

  const scoped = await previewRuleMatches(bank.db, bank.householdId, {
    matchType: 'CONTAINS',
    pattern: 'zaffari',
    connectionId: bank.connectionId,
  })
  const anyBank = await previewRuleMatches(bank.db, bank.householdId, {
    matchType: 'CONTAINS',
    pattern: 'zaffari',
  })

  expect(scoped.total).toBe(1)
  expect(anyBank.total).toBe(2)
})

it('never reaches another household', async () => {
  const ours = await seedBank('Klassmann', 'inacio@example.com')
  const theirs = await seedBank('Silva', 'silva@example.com')
  await insertTransaction(ours.db, ours.accountId, { description: 'ZAFFARI NOSSO' })
  await insertTransaction(theirs.db, theirs.accountId, { description: 'ZAFFARI DELES' })

  const result = await previewRuleMatches(ours.db, ours.householdId, {
    matchType: 'CONTAINS',
    pattern: 'zaffari',
  })

  expect(descriptions(result)).toEqual(['ZAFFARI NOSSO'])
})

it('returns nothing for a pattern that normalizes away', async () => {
  const { db, householdId, accountId } = await seedBank('Klassmann', 'inacio@example.com')
  await insertTransaction(db, accountId, { description: 'ZAFFARI PORTO ALEG' })

  const result = await previewRuleMatches(db, householdId, { matchType: 'CONTAINS', pattern: '  ***  ' })

  expect(result).toEqual({ total: 0, items: [] })
})

it('caps the listed rows but still counts them all', async () => {
  const { db, householdId, accountId } = await seedBank('Klassmann', 'inacio@example.com')
  for (let i = 0; i < 5; i++) {
    await insertTransaction(db, accountId, { description: `ZAFFARI LOJA ${i}`, date: `2026-08-0${i + 1}` })
  }

  const result = await previewRuleMatches(db, householdId, { matchType: 'CONTAINS', pattern: 'zaffari' }, 2)

  expect(result.total).toBe(5)
  expect(result.items).toHaveLength(2)
  // Newest first, so the two most recent dates lead.
  expect(descriptions(result)).toEqual(['ZAFFARI LOJA 4', 'ZAFFARI LOJA 3'])
})

it('carries the current category so an about-to-change row reads as such', async () => {
  const { db, householdId, accountId } = await seedBank('Klassmann', 'inacio@example.com')
  // 'Fees' is unmapped by the seed rules, so this row lands uncategorized.
  await insertTransaction(db, accountId, { description: 'ZAFFARI PORTO ALEG', pluggyCategory: 'Fees' })

  const result = await previewRuleMatches(db, householdId, { matchType: 'CONTAINS', pattern: 'zaffari' })

  expect(result.items[0].categoryName).toBeNull()
  expect(result.items[0].institution).toBe('Itau')
})
