'use client'

import { useActionState } from 'react'
import type { SettingsState } from '../categories/state'
import { createRuleAction, deleteRuleAction } from './actions'

const INITIAL: SettingsState = { error: null, message: null }

/**
 * The forms live here, not on the page, because a `(prevState, formData)`
 * action cannot be handed to a bare `<form action={...}>`: React calls a bare
 * form action with FormData as its only argument, so the action would run
 * with prevState = FormData and formData = undefined. useActionState is what
 * supplies the previous state and makes the returned error and the
 * "N transactions recategorized" count renderable at all.
 */
function Feedback({ state }: { state: SettingsState }) {
  return (
    <>
      {state.error ? (
        <p role="alert" className="form__error">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="form__message">{state.message}</p> : null}
    </>
  )
}

export function CreateRuleForm({ categories }: { categories: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createRuleAction, INITIAL)

  return (
    <form action={formAction}>
      <label>
        Match
        <select name="matchType" defaultValue="CONTAINS">
          <option value="CONTAINS">anything containing</option>
          <option value="EXACT">exactly</option>
        </select>
      </label>
      <label>
        Pattern
        <input name="pattern" type="text" required />
      </label>
      <label>
        Category
        <select name="categoryId" required defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <Feedback state={state} />
      <button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add rule'}
      </button>
    </form>
  )
}

export function DeleteRuleForm({ ruleId }: { ruleId: string }) {
  const [state, formAction, pending] = useActionState(deleteRuleAction, INITIAL)

  return (
    <form action={formAction}>
      <input type="hidden" name="ruleId" value={ruleId} />
      <Feedback state={state} />
      <button type="submit" disabled={pending}>
        {pending ? 'Deleting…' : 'Delete'}
      </button>
    </form>
  )
}
