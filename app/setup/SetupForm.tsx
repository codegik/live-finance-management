'use client'

import { useActionState } from 'react'
import { setupAction } from './actions'
import type { SetupState } from './state'

const INITIAL: SetupState = { error: null }

export function SetupForm() {
  const [state, formAction, pending] = useActionState(setupAction, INITIAL)

  return (
    <form action={formAction}>
      <label>
        Household name
        <input name="householdName" type="text" required autoComplete="off" />
      </label>
      <label>
        Your name
        <input name="name" type="text" required autoComplete="name" />
      </label>
      <label>
        Email
        <input name="email" type="email" required autoComplete="username" />
      </label>
      <label>
        Choose a password
        <input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      {state.error ? (
        <p role="alert" className="form__error">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create household'}
      </button>
    </form>
  )
}
