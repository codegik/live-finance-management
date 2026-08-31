'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { createInvite, emailInUse, revokeInvite } from '@/lib/db/invites'
import {
  EMAIL_IN_USE_ERROR,
  EMPTY_FIELDS_ERROR,
  INVALID_EMAIL_ERROR,
  type InviteState,
  REVOKED_MESSAGE,
  type RevokeState,
  UNKNOWN_INVITE_ERROR,
} from './state'

const email = z.string().email()

export async function createInviteAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const session = await requireSession()

  const name = String(formData.get('name') ?? '').trim()
  const rawEmail = String(formData.get('email') ?? '').trim()
  if (!name || !rawEmail) return { error: EMPTY_FIELDS_ERROR, inviteUrl: null }
  if (!email.safeParse(rawEmail).success) return { error: INVALID_EMAIL_ERROR, inviteUrl: null }

  const db = getDb()
  // A redeem would fail on the unique-email index anyway; catching it here means
  // the inviter learns before they send a link that can never be opened.
  if (await emailInUse(db, rawEmail)) return { error: EMAIL_IN_USE_ERROR, inviteUrl: null }

  const { token } = await createInvite(db, {
    householdId: session.householdId,
    email: rawEmail,
    name,
  })

  revalidatePath('/settings/members')
  return { error: null, inviteUrl: `/join/${token}` }
}

export async function revokeInviteAction(
  _prev: RevokeState,
  formData: FormData,
): Promise<RevokeState> {
  const session = await requireSession()
  const inviteId = String(formData.get('inviteId') ?? '')
  if (!inviteId) return { error: UNKNOWN_INVITE_ERROR, message: null }

  const revoked = await revokeInvite(getDb(), session.householdId, inviteId)
  if (!revoked) return { error: UNKNOWN_INVITE_ERROR, message: null }

  revalidatePath('/settings/members')
  return { error: null, message: REVOKED_MESSAGE }
}
