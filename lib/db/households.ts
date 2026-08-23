import { eq } from 'drizzle-orm'
import type { Db } from './client'
import { households, users, type User } from './schema'

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
