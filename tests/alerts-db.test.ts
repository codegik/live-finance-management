import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { clearFired, listFiredAlerts, recordFired } from '@/lib/db/alerts'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { resetDb, testDb, useTestEnv } from './helpers/db'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

async function seedHousehold(email: string) {
  const db = testDb()
  const { householdId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email, name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const categories = await listCategories(db, householdId)
  return { db, householdId, categoryId: categories[0].id }
}

it('records a fired threshold and reads it back for its own month', async () => {
  const { db, householdId, categoryId } = await seedHousehold('a@example.com')

  await recordFired(db, householdId, '2026-08', [{ categoryId, threshold: 80 }])

  expect(await listFiredAlerts(db, householdId, '2026-08')).toEqual([{ categoryId, threshold: 80 }])
  expect(await listFiredAlerts(db, householdId, '2026-09')).toEqual([])
})

it('is idempotent, so a duplicate send does not error', async () => {
  const { db, householdId, categoryId } = await seedHousehold('b@example.com')

  await recordFired(db, householdId, '2026-08', [{ categoryId, threshold: 80 }])
  await recordFired(db, householdId, '2026-08', [{ categoryId, threshold: 80 }])

  expect(await listFiredAlerts(db, householdId, '2026-08')).toHaveLength(1)
})

it('never reads another household state', async () => {
  const a = await seedHousehold('c@example.com')
  const b = await seedHousehold('d@example.com')
  await recordFired(a.db, a.householdId, '2026-08', [{ categoryId: a.categoryId, threshold: 100 }])

  expect(await listFiredAlerts(b.db, b.householdId, '2026-08')).toEqual([])
})

it('clears only the thresholds it is given', async () => {
  const { db, householdId, categoryId } = await seedHousehold('e@example.com')
  await recordFired(db, householdId, '2026-08', [
    { categoryId, threshold: 80 },
    { categoryId, threshold: 100 },
  ])

  await clearFired(db, householdId, '2026-08', [{ categoryId, threshold: 100 }])

  expect(await listFiredAlerts(db, householdId, '2026-08')).toEqual([{ categoryId, threshold: 80 }])
})

it('treats an empty list as a no-op rather than as everything', async () => {
  const { db, householdId, categoryId } = await seedHousehold('f@example.com')
  await recordFired(db, householdId, '2026-08', [{ categoryId, threshold: 80 }])

  await clearFired(db, householdId, '2026-08', [])
  await recordFired(db, householdId, '2026-08', [])

  expect(await listFiredAlerts(db, householdId, '2026-08')).toHaveLength(1)
})
