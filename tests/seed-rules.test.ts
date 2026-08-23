import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { listRules, seedDefaultRules } from '@/lib/db/rules'
import { connections } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { recategorize } from '@/lib/sync/categorize'
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
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
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
  // Default rules arrive on the reconcile path, not at household creation:
  // they only matter once transactions exist, and a household with no
  // rules is a state the rest of the suite relies on.
  await seedDefaultRules(db, householdId)
  return { db, householdId, accountId }
}

async function categoryNamed(householdId: string, name: string): Promise<string> {
  const all = await listCategories(testDb(), householdId)
  return all.find((c) => c.name === name)!.id
}

it('gives every household a car-maintenance category', async () => {
  const { householdId } = await seedHousehold()

  const names = (await listCategories(testDb(), householdId)).map((c) => c.name)

  expect(names).toContain('Manutenção de carro')
})

it('seeds the default merchant rules', async () => {
  const { db, householdId } = await seedHousehold()

  const rules = await listRules(db, householdId)

  expect(rules.map((r) => [r.matchType, r.pattern, r.categoryName])).toEqual(
    expect.arrayContaining([
      ['CONTAINS', 'CLUBE LIVELO', 'Assinaturas'],
      ['CONTAINS', 'MECANICA', 'Manutenção de carro'],
    ]),
  )
})

it('categorizes the real descriptors those rules were written for', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  // Real descriptors, verbatim from a live connection. Both are instalments,
  // so the parcel suffix must be stripped before the rule can match.
  const livelo = await insertTransaction(db, accountId, {
    description: 'CLUBE LIVELO*Clube07/12',
    pluggyCategory: 'Mileage programs',
  })
  const mecanica = await insertTransaction(db, accountId, {
    description: 'AUTO MECANICA BOA 01/10',
    pluggyCategory: 'Vehicle maintenance',
  })

  await recategorize(db, { householdId })

  const rows = await listTransactions(db, householdId)
  const byId = new Map(rows.map((r) => [r.id, r]))
  // The rule must beat Pluggy's own answer, which would have said Lazer.
  expect(byId.get(livelo)!.categoryId).toBe(await categoryNamed(householdId, 'Assinaturas'))
  expect(byId.get(livelo)!.categorySource).toBe('RULE')
  expect(byId.get(mecanica)!.categoryId).toBe(
    await categoryNamed(householdId, 'Manutenção de carro'),
  )
})

it('does not let the CLUBE LIVELO rule swallow the unrelated LIVELO store', async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const store = await insertTransaction(db, accountId, {
    description: 'LIVELOSANTANA DE P04/06',
    pluggyCategory: 'Mileage programs',
  })

  await recategorize(db, { householdId })

  const row = (await listTransactions(db, householdId)).find((r) => r.id === store)!
  expect(row.categorySource).toBe('PLUGGY')
  expect(row.categoryId).toBe(await categoryNamed(householdId, 'Lazer'))
})

it("routes Pluggy's own vehicle categories to the car-maintenance budget", async () => {
  const { db, householdId, accountId } = await seedHousehold()
  const id = await insertTransaction(db, accountId, {
    description: 'OFICINA SEM NOME CONHECIDO',
    pluggyCategory: 'Vehicle maintenance',
  })

  await recategorize(db, { householdId })

  const row = (await listTransactions(db, householdId)).find((r) => r.id === id)!
  expect(row.categoryId).toBe(await categoryNamed(householdId, 'Manutenção de carro'))
  expect(row.categorySource).toBe('PLUGGY')
})
