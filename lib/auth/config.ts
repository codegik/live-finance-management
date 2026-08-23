import { eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { verifyPassword } from './password'

export type SessionUser = {
  id: string
  email: string
  name: string
  householdId: string
}

export type Credentials = { email: string; password: string }

export async function authorizeCredentials(
  db: Db,
  credentials: Credentials,
): Promise<SessionUser | null> {
  const email = credentials.email.trim().toLowerCase()

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!user?.passwordHash) return null

  const ok = await verifyPassword(credentials.password, user.passwordHash)
  if (!ok) return null

  return { id: user.id, email: user.email, name: user.name, householdId: user.householdId }
}
