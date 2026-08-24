import { beforeEach, expect, it } from 'vitest'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { sessionIsStillValid } from '@/lib/auth/session'
import { households } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { resetDb, testDb, useTestEnv } from './helpers/db'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

/**
 * The household id is written into the JWT at sign-in and never revisited, so
 * a correctly-signed token can outlive the household it names. What that
 * produced was not an error but a lie: /ledger rendered "No transactions yet.
 * Connect a card to get started." over a database holding three thousand of
 * them, because every query was scoped to a household that no longer existed.
 */
async function seed() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  return { db, householdId, userId }
}

it('accepts a session naming the household the user really belongs to', async () => {
  const { db, householdId, userId } = await seed()

  expect(await sessionIsStillValid(db, userId, householdId)).toBe(true)
})

it('rejects a token whose household has been dropped and reseeded', async () => {
  const { db, householdId, userId } = await seed()

  // What a database reset leaves behind: the browser still holds the old token.
  await db.delete(households).where(eq(households.id, householdId))

  expect(await sessionIsStillValid(db, userId, householdId)).toBe(false)
})

it('rejects a token naming a household the user does not belong to', async () => {
  const { db, userId } = await seed()
  const { householdId: otherHouseholdId } = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })

  // Not a reset this time -- a forged or swapped claim. Same answer.
  expect(await sessionIsStillValid(db, userId, otherHouseholdId)).toBe(false)
})

it('rejects a user id that no longer exists at all', async () => {
  const { db, householdId } = await seed()

  expect(await sessionIsStillValid(db, crypto.randomUUID(), householdId)).toBe(false)
})
