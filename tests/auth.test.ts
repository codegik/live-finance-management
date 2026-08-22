import type { Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { beforeEach, expect, it } from 'vitest'
import { authorizeCredentials } from '@/lib/auth/config'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { attachHouseholdToSession, attachHouseholdToToken } from '@/lib/auth/session'
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

it('carries householdId and user id through the real jwt and session callback chain', async () => {
  const { db, household } = await seed()

  const signedInUser = await authorizeCredentials(db, {
    email: 'inacio@example.com',
    password: 'correct horse',
  })
  expect(signedInUser).not.toBeNull()

  // Mirrors what @auth/core does before invoking the jwt callback on sign-in:
  // it seeds token.sub from user.id.
  const token = attachHouseholdToToken({
    token: { sub: signedInUser!.id } as JWT,
    user: signedInUser!,
  })

  const session = attachHouseholdToSession({
    session: { user: {}, expires: '2099-01-01T00:00:00.000Z' } as Session,
    token,
  })

  expect(session.user.householdId).toBe(household.householdId)
  expect(session.user.id).toBe(signedInUser!.id)
})

it('preserves householdId on a token-refresh call where no user is passed', async () => {
  const { db, household } = await seed()

  const signedInUser = await authorizeCredentials(db, {
    email: 'inacio@example.com',
    password: 'correct horse',
  })
  expect(signedInUser).not.toBeNull()

  const initialToken = attachHouseholdToToken({
    token: { sub: signedInUser!.id } as JWT,
    user: signedInUser!,
  })
  expect(initialToken.householdId).toBe(household.householdId)

  // Auth.js calls jwt() again on every session access with only the token
  // (no user), e.g. token refresh / getSession(). householdId must survive.
  const refreshedToken = attachHouseholdToToken({ token: initialToken })

  expect(refreshedToken.householdId).toBe(household.householdId)
})
