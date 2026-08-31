import { asc, count, eq, sql } from 'drizzle-orm'
import { hashPassword } from '../auth/password'
import { seedCategories } from './categories'
import type { Db } from './client'
import { households, users, type User } from './schema'

export type Member = { id: string; email: string; name: string; createdAt: Date }

/** Everyone who belongs to the household, oldest first (the household's owner). */
export async function listMembers(db: Db, householdId: string): Promise<Member[]> {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.householdId, householdId))
    .orderBy(asc(users.createdAt))
}

/** Fixed key for the advisory lock guarding first-household creation. */
const SETUP_LOCK_KEY = 4_120_251

export type CreateHouseholdInput = {
  name: string
  owner: { email: string; name: string; passwordHash: string }
}

export async function createHousehold(
  db: Db,
  input: CreateHouseholdInput,
): Promise<{ householdId: string; userId: string }> {
  return db.transaction(async (tx) => {
    const [household] = await tx
      .insert(households)
      .values({ name: input.name })
      .returning({ id: households.id })

    await seedCategories(tx, household.id)

    const [user] = await tx
      .insert(users)
      .values({
        householdId: household.id,
        email: input.owner.email.toLowerCase(),
        name: input.owner.name,
        passwordHash: input.owner.passwordHash,
      })
      .returning({ id: users.id })

    return { householdId: household.id, userId: user.id }
  })
}

export async function listHouseholdUsers(db: Db, householdId: string): Promise<User[]> {
  return db.select().from(users).where(eq(users.householdId, householdId))
}

export async function countHouseholds(db: Db): Promise<number> {
  const [row] = await db.select({ value: count() }).from(households)
  return row?.value ?? 0
}

export type CreateFirstHouseholdInput = {
  householdName: string
  email: string
  name: string
  password: string
}

/**
 * Creates the household that bootstraps the app, and only ever that one.
 *
 * Registration is invite-only, so nothing else can create the first
 * household — but that also means this runs on an endpoint reachable before
 * anyone has signed in, and it must not be usable twice.
 *
 * A count-then-insert would not be enough: under READ COMMITTED two
 * concurrent callers each see zero households before either commits, and both
 * proceed. The advisory lock serialises them, so the second caller's re-check
 * runs after the first has committed and sees the row. The lock is
 * transaction-scoped, so it is released on commit or rollback either way.
 */
export async function createFirstHousehold(
  db: Db,
  input: CreateFirstHouseholdInput,
): Promise<{ householdId: string; userId: string }> {
  const passwordHash = await hashPassword(input.password)

  return db.transaction(async (tx) => {
    // Arbitrary but fixed: this constant only has to agree with itself.
    await tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK_KEY})`)

    const [row] = await tx.select({ value: count() }).from(households)
    if ((row?.value ?? 0) > 0) throw new Error('HOUSEHOLD_EXISTS')

    const [household] = await tx
      .insert(households)
      .values({ name: input.householdName })
      .returning({ id: households.id })

    await seedCategories(tx, household.id)

    const [user] = await tx
      .insert(users)
      .values({
        householdId: household.id,
        email: input.email.trim().toLowerCase(),
        name: input.name,
        passwordHash,
      })
      .returning({ id: users.id })

    return { householdId: household.id, userId: user.id }
  })
}
