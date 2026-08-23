import { beforeEach, expect, inject, it } from 'vitest'
import { authorizeCredentials } from '@/lib/auth/config'
import { createDb } from '@/lib/db/client'
import { countHouseholds, createFirstHousehold, createHousehold } from '@/lib/db/households'
import { resetDb, testDb } from './helpers/db'

beforeEach(resetDb)

const owner = {
  householdName: 'Klassmann',
  email: 'inacio@example.com',
  name: 'Inacio',
  password: 'a-real-password',
}

it('reports no households on an empty database', async () => {
  expect(await countHouseholds(testDb())).toBe(0)
})

it('creates the first household and its owner, who can then sign in', async () => {
  const db = testDb()

  const { householdId, userId } = await createFirstHousehold(db, owner)

  expect(householdId).toBeTruthy()
  expect(userId).toBeTruthy()
  expect(await countHouseholds(db)).toBe(1)

  // The point of the whole feature: the account it creates must actually work.
  const session = await authorizeCredentials(db, {
    email: owner.email,
    password: owner.password,
  })
  expect(session?.householdId).toBe(householdId)
})

it('refuses to create a second household', async () => {
  const db = testDb()
  await createHousehold(db, {
    name: 'Existing',
    owner: { email: 'someone@example.com', name: 'Someone', passwordHash: 'hash' },
  })

  await expect(
    createFirstHousehold(db, { ...owner, email: 'attacker@example.com' }),
  ).rejects.toThrow('HOUSEHOLD_EXISTS')

  expect(await countHouseholds(db)).toBe(1)
})

it('lets exactly one of two concurrent setup attempts win', async () => {
  // Two independent connection pools on purpose. Sharing one handle does not
  // reproduce the race: the calls end up serialised, and the test then passes
  // against a count-then-insert with no lock at all — proving nothing. Two
  // pools is also what two real requests hitting the route would use.
  const a = createDb(inject('databaseUrl'))
  const b = createDb(inject('databaseUrl'))

  // A plain count-then-insert lets both through under READ COMMITTED: each
  // transaction sees zero households before either commits. This is the
  // assertion that distinguishes a real guard from an incidental one.
  const results = await Promise.allSettled([
    createFirstHousehold(a.db, { ...owner, email: 'first@example.com' }),
    createFirstHousehold(b.db, { ...owner, email: 'second@example.com' }),
  ]).finally(async () => {
    await Promise.all([a.sql.end(), b.sql.end()])
  })

  const fulfilled = results.filter((r) => r.status === 'fulfilled')
  const rejected = results.filter((r) => r.status === 'rejected')

  expect(fulfilled).toHaveLength(1)
  expect(rejected).toHaveLength(1)
  // The loser must fail for the honest reason, not because of some unrelated
  // constraint violation that happens to abort it.
  expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
    message: 'HOUSEHOLD_EXISTS',
  })
  expect(await countHouseholds(testDb())).toBe(1)
})

it('normalises the owner email to lower case', async () => {
  const db = testDb()

  await createFirstHousehold(db, { ...owner, email: 'Inacio@Example.COM' })

  const session = await authorizeCredentials(db, {
    email: 'inacio@example.com',
    password: owner.password,
  })
  expect(session).not.toBeNull()
})
