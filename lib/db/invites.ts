import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { hashPassword } from '@/lib/auth/password'
import type { SessionUser } from '@/lib/auth/config'
import type { Db } from './client'
import { householdInvites, users } from './schema'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createInvite(
  db: Db,
  input: { householdId: string; email: string; name: string },
): Promise<{ token: string }> {
  const token = randomBytes(32).toString('base64url')
  await db.insert(householdInvites).values({
    householdId: input.householdId,
    email: input.email.trim().toLowerCase(),
    name: input.name,
    tokenHash: hashToken(token),
  })
  return { token }
}

export async function redeemInvite(
  db: Db,
  input: { token: string; password: string },
): Promise<SessionUser> {
  const tokenHash = hashToken(input.token)

  return db.transaction(async (tx) => {
    const [claimedInvite] = await tx
      .update(householdInvites)
      .set({ redeemedAt: new Date() })
      .where(and(eq(householdInvites.tokenHash, tokenHash), isNull(householdInvites.redeemedAt)))
      .returning()

    if (!claimedInvite) throw new Error('INVALID_INVITE')

    const [user] = await tx
      .insert(users)
      .values({
        householdId: claimedInvite.householdId,
        email: claimedInvite.email,
        name: claimedInvite.name,
        passwordHash: await hashPassword(input.password),
      })
      .returning()

    return { id: user.id, email: user.email, name: user.name, householdId: user.householdId }
  })
}
