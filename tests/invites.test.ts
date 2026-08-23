import { beforeEach, expect, it } from 'vitest'
import { authorizeCredentials } from '@/lib/auth/config'
import { hashPassword } from '@/lib/auth/password'
import { createInvite, redeemInvite } from '@/lib/db/invites'
import { createHousehold, listHouseholdUsers } from '@/lib/db/households'
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
  return { db, householdId: household.householdId }
}

it('lets an invited member set a password and join the same household', async () => {
  const { db, householdId } = await seed()

  const { token } = await createInvite(db, {
    householdId,
    email: 'wife@example.com',
    name: 'Wife',
  })
  const joined = await redeemInvite(db, { token, password: 'her own password' })

  expect(joined.householdId).toBe(householdId)

  const members = await listHouseholdUsers(db, householdId)
  expect(members.map((m) => m.email).sort()).toEqual(['inacio@example.com', 'wife@example.com'])

  const signedIn = await authorizeCredentials(db, {
    email: 'wife@example.com',
    password: 'her own password',
  })
  expect(signedIn?.householdId).toBe(householdId)
})

it('refuses to redeem the same token twice', async () => {
  const { db, householdId } = await seed()
  const { token } = await createInvite(db, { householdId, email: 'wife@example.com', name: 'Wife' })
  await redeemInvite(db, { token, password: 'first' })

  await expect(redeemInvite(db, { token, password: 'second' })).rejects.toThrow('INVALID_INVITE')
})

it('refuses an unknown token', async () => {
  const { db } = await seed()

  await expect(redeemInvite(db, { token: 'nope', password: 'x' })).rejects.toThrow('INVALID_INVITE')
})

it('does not store the raw token', async () => {
  const { db, householdId } = await seed()
  const { token } = await createInvite(db, { householdId, email: 'wife@example.com', name: 'Wife' })

  const { householdInvites } = await import('@/lib/db/schema')
  const [row] = await db.select().from(householdInvites)

  expect(row.tokenHash).not.toBe(token)
})

it('atomically enforces single-use through the invite claim', async () => {
  const { db, householdId } = await seed()
  const { token } = await createInvite(db, { householdId, email: 'wife@example.com', name: 'Wife' })

  const results = await Promise.allSettled([
    redeemInvite(db, { token, password: 'first-password' }),
    redeemInvite(db, { token, password: 'second-password' }),
  ])

  const fulfilled = results.filter((r) => r.status === 'fulfilled')
  const rejected = results.filter((r) => r.status === 'rejected')

  expect(fulfilled).toHaveLength(1)
  expect(rejected).toHaveLength(1)
  expect(rejected[0].status === 'rejected' && rejected[0].reason.message).toBe('INVALID_INVITE')

  const members = await listHouseholdUsers(db, householdId)
  expect(members).toHaveLength(2)
})
