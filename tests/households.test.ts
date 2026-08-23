import { beforeEach, expect, it } from 'vitest'
import { createHousehold, listHouseholdUsers } from '@/lib/db/households'
import { resetDb, testDb } from './helpers/db'

beforeEach(resetDb)

it('creates a household with its owner and lists members scoped to it', async () => {
  const db = testDb()

  const ours = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: 'hash-a' },
  })
  const theirs = await createHousehold(db, {
    name: 'Other Household',
    owner: { email: 'stranger@example.com', name: 'Stranger', passwordHash: 'hash-b' },
  })

  const members = await listHouseholdUsers(db, ours.householdId)

  expect(members).toHaveLength(1)
  expect(members[0].email).toBe('inacio@example.com')
  expect(members[0].householdId).toBe(ours.householdId)
  expect(members.map((m) => m.id)).not.toContain(theirs.userId)
})

it('rejects a duplicate email across households', async () => {
  const db = testDb()
  await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: 'hash-a' },
  })

  await expect(
    createHousehold(db, {
      name: 'Second',
      owner: { email: 'inacio@example.com', name: 'Copy', passwordHash: 'hash-c' },
    }),
  ).rejects.toThrow()
})
