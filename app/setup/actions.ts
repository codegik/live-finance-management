'use server'

import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { createFirstHousehold } from '@/lib/db/households'
import {
  HOUSEHOLD_EXISTS_ERROR,
  INVALID_EMAIL_ERROR,
  MISSING_FIELD_ERROR,
  SHORT_PASSWORD_ERROR,
  type SetupState,
} from './state'

export async function setupAction(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const householdName = String(formData.get('householdName') ?? '').trim()
  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!householdName || !name || !email) return { error: MISSING_FIELD_ERROR }
  if (!email.includes('@')) return { error: INVALID_EMAIL_ERROR }
  if (password.length < 8) return { error: SHORT_PASSWORD_ERROR }

  try {
    await createFirstHousehold(getDb(), { householdName, name, email, password })
  } catch (error) {
    // Losing the race, or arriving after setup is done, is ordinary user
    // error rather than a server fault. Anything else still surfaces as a
    // 500, which is what it is.
    if (error instanceof Error && error.message === 'HOUSEHOLD_EXISTS') {
      return { error: HOUSEHOLD_EXISTS_ERROR }
    }
    throw error
  }

  // Outside the try on purpose: redirect() signals by throwing a
  // NEXT_REDIRECT-tagged error, which must never be caught as a form error.
  redirect('/signin')
}
