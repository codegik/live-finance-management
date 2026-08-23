import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import {
  archiveCategory,
  createCategory,
  listCategories,
  renameCategory,
} from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { SEED_CATEGORIES } from '@/lib/domain/seed-categories'
import { resetDb, testDb, useTestEnv } from './helpers/db'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

async function seedHousehold(name = 'Klassmann', email = 'inacio@example.com') {
  const db = testDb()
  const { householdId } = await createHousehold(db, {
    name,
    owner: { email, name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  return { db, householdId }
}

it('gives a new household the seeded taxonomy in display order', async () => {
  const { db, householdId } = await seedHousehold()

  const list = await listCategories(db, householdId)

  expect(list).toHaveLength(SEED_CATEGORIES.length)
  expect(list.map((c) => c.name)).toEqual(SEED_CATEGORIES.map((c) => c.name))
  expect(list[0].name).toBe('Supermercado')
  expect(list[0].seedKey).toBe('supermarket')
})

it('keeps the seed key when a seeded category is renamed', async () => {
  const { db, householdId } = await seedHousehold()
  const [supermarket] = await listCategories(db, householdId)

  await renameCategory(db, householdId, supermarket.id, 'Mercado')

  const [renamed] = await listCategories(db, householdId)
  expect(renamed.name).toBe('Mercado')
  // The Pluggy map targets seed_key, so renaming must not break auto-categorization.
  expect(renamed.seedKey).toBe('supermarket')
})

it('gives a household-created category a null seed key', async () => {
  const { db, householdId } = await seedHousehold()

  const created = await createCategory(db, householdId, 'Presentes')

  expect(created.seedKey).toBeNull()
  expect(created.name).toBe('Presentes')
})

it('hides an archived category from the default listing but still returns it on request', async () => {
  const { db, householdId } = await seedHousehold()
  const [supermarket] = await listCategories(db, householdId)

  await archiveCategory(db, householdId, supermarket.id)

  const visible = await listCategories(db, householdId)
  expect(visible.map((c) => c.id)).not.toContain(supermarket.id)

  const all = await listCategories(db, householdId, { includeArchived: true })
  expect(all.map((c) => c.id)).toContain(supermarket.id)
})

it('scopes every category operation to its household', async () => {
  const { db, householdId } = await seedHousehold()
  const { householdId: otherId } = await seedHousehold('Other', 'other@example.com')
  const [mine] = await listCategories(db, householdId)

  // A category id from another household must be inert, not merely unauthorized.
  await renameCategory(db, otherId, mine.id, 'Hijacked')
  await archiveCategory(db, otherId, mine.id)

  const [unchanged] = await listCategories(db, householdId)
  expect(unchanged.name).toBe('Supermercado')
  expect(unchanged.archivedAt).toBeNull()
})
