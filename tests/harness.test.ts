import { beforeEach, expect, it } from 'vitest'
import { households } from '@/lib/db/schema'
import { resetDb, testDb } from './helpers/db'

beforeEach(resetDb)

it('runs migrations and round-trips a row through real postgres', async () => {
  const db = testDb()
  await db.insert(households).values({ name: 'Klassmann' })

  const rows = await db.select().from(households)

  expect(rows).toHaveLength(1)
  expect(rows[0].name).toBe('Klassmann')
  expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/)
})
