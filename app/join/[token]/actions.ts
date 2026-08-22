'use server'

import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { redeemInvite } from '@/lib/db/invites'
import { INVALID_INVITE_ERROR, SHORT_PASSWORD_ERROR, type JoinState } from './state'

export async function joinAction(
  token: string,
  _prev: JoinState,
  formData: FormData,
): Promise<JoinState> {
  const password = String(formData.get('password') ?? '')
  if (password.length < 8) return { error: SHORT_PASSWORD_ERROR }

  try {
    await redeemInvite(getDb(), { token, password })
  } catch (error) {
    // A used or unknown token is ordinary user error, not a server error.
    // Anything else still surfaces as a 500, which is what it is.
    if (error instanceof Error && error.message === 'INVALID_INVITE') {
      return { error: INVALID_INVITE_ERROR }
    }
    throw error
  }

  // Outside the try on purpose: redirect() signals by throwing a
  // NEXT_REDIRECT-tagged error, which must never be caught as a form error.
  redirect('/signin')
}
