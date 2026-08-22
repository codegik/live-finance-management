import { beforeEach, expect, it } from 'vitest'
import { authorizeCredentials } from '@/lib/auth/config'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { resetDb, testDb } from './helpers/db'

beforeEach(resetDb)

async function seed() {
  const db = testDb()
  const household = await createHousehold(db, {
    name: 'Klassmann',
    owner: {
      email: 'inacio@example.com',
      name: 'Inacio',
      passwordHash: await hashPassword('correct horse'),
    },
  })
  return { db, household }
}

it('authorizes a correct password and carries the household on the session user', async () => {
  const { db, household } = await seed()

  const result = await authorizeCredentials(db, {
    email: 'inacio@example.com',
    password: 'correct horse',
  })

  expect(result).not.toBeNull()
  expect(result!.householdId).toBe(household.householdId)
  expect(result!.email).toBe('inacio@example.com')
})

it('rejects a wrong password and an unknown email identically', async () => {
  const { db } = await seed()

  expect(await authorizeCredentials(db, { email: 'inacio@example.com', password: 'wrong' })).toBeNull()
  expect(await authorizeCredentials(db, { email: 'nobody@example.com', password: 'correct horse' })).toBeNull()
})

it('rejects a user who has not yet set a password', async () => {
  const { db, household } = await seed()
  const { users } = await import('@/lib/db/schema')
  await db.insert(users).values({
    householdId: household.householdId,
    email: 'wife@example.com',
    name: 'Wife',
    passwordHash: null,
  })

  expect(await authorizeCredentials(db, { email: 'wife@example.com', password: '' })).toBeNull()
})

it('matches email case-insensitively', async () => {
  const { db } = await seed()

  const result = await authorizeCredentials(db, {
    email: 'INACIO@Example.com',
    password: 'correct horse',
  })

  expect(result).not.toBeNull()
})

it('produces hashes that verify but are not the plaintext', async () => {
  const hash = await hashPassword('correct horse')

  expect(hash).not.toBe('correct horse')
  expect(await verifyPassword('correct horse', hash)).toBe(true)
  expect(await verifyPassword('wrong', hash)).toBe(false)
})
