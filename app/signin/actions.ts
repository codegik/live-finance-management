'use server'

import { AuthError } from 'next-auth'
import { signIn } from '@/lib/auth/session'
import { isNextRedirectError } from '@/lib/errors'
import { CREDENTIALS_ERROR, type SignInState } from './state'

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  try {
    await signIn('credentials', {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      redirectTo: '/ledger',
    })
  } catch (error) {
    // On success signIn throws the NEXT_REDIRECT that navigates to /ledger.
    // Swallowing it here would strand the user on the sign-in page.
    if (isNextRedirectError(error)) throw error

    if (error instanceof AuthError && error.type === 'CredentialsSignin') {
      return { error: CREDENTIALS_ERROR }
    }

    // Anything else is a real server failure. Let it surface as one rather
    // than telling the user their password is wrong when it isn't.
    throw error
  }

  // signIn with redirectTo always throws, so this is only reached if that ever
  // stops being true; returning a clean state beats falling through.
  return { error: null }
}
