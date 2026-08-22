'use client'

import { useActionState } from 'react'
import { joinAction } from './actions'
import type { JoinState } from './state'

const INITIAL: JoinState = { error: null }

export function JoinForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(joinAction.bind(null, token), INITIAL)

  return (
    <form action={formAction}>
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
        {pending ? 'Joining…' : 'Join'}
      </button>
    </form>
  )
}
