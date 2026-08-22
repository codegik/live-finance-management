'use client'

import { useActionState } from 'react'
import { signInAction } from './actions'
import type { SignInState } from './state'

const INITIAL: SignInState = { error: null }

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL)

  return (
    <form action={formAction}>
      <label>
        Email
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        Password
        <input name="password" type="password" required autoComplete="current-password" />
      </label>
      {state.error ? (
        <p role="alert" className="form__error">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
