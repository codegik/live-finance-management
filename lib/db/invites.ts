import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { hashPassword } from '@/lib/auth/password'
import type { SessionUser } from '@/lib/auth/config'
import type { Db } from './client'
import { householdInvites, users } from './schema'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export type PendingInvite = { id: string; email: string; name: string; createdAt: Date }

/**
 * Invites made for this household that nobody has redeemed yet, newest first.
 * The token itself is never returned -- only its hash is stored -- so this list
 * can name who was invited but cannot re-derive their join link. A lost link is
 * replaced by revoking and inviting again.
 */
export async function listPendingInvites(db: Db, householdId: string): Promise<PendingInvite[]> {
  return db
    .select({
      id: householdInvites.id,
      email: householdInvites.email,
      name: householdInvites.name,
      createdAt: householdInvites.createdAt,
    })
    .from(householdInvites)
    .where(and(eq(householdInvites.householdId, householdId), isNull(householdInvites.redeemedAt)))
    .orderBy(desc(householdInvites.createdAt))
}

/**
 * Drop an unredeemed invite. Scoped by household so one house can never revoke
 * another's, and guarded by `redeemedAt is null` so a link that has already
 * become a user cannot be pulled out from under them.
 */
export async function revokeInvite(
  db: Db,
  householdId: string,
  inviteId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(householdInvites)
    .where(
      and(
        eq(householdInvites.id, inviteId),
        eq(householdInvites.householdId, householdId),
        isNull(householdInvites.redeemedAt),
      ),
    )
    .returning({ id: householdInvites.id })
  return deleted.length > 0
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

/**
 * True if some user already owns this email. Email is globally unique across
 * every household, so an invite to an address that is already a user could
 * never be redeemed -- catching it here turns a dead-end join link into a
 * message the inviter can read before they send it.
 */
export async function emailInUse(db: Db, email: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1)
  return Boolean(existing)
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
