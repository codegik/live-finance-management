'use client'

import { useActionState } from 'react'
import { archiveCategoryAction, createCategoryAction, renameCategoryAction } from './actions'
import type { SettingsState } from './state'

const INITIAL: SettingsState = { error: null, message: null }

/**
 * The forms live here, not on the page, because a `(prevState, formData)`
 * action cannot be handed to a bare `<form action={...}>`: React calls a bare
 * form action with FormData as its only argument, so the action would run
 * with prevState = FormData and formData = undefined. useActionState is what
 * supplies the previous state and makes the returned error/message
 * renderable at all.
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

export function CreateCategoryForm() {
  const [state, formAction, pending] = useActionState(createCategoryAction, INITIAL)

  return (
    <form action={formAction}>
      <label>
        New category
        <input name="name" type="text" required />
      </label>
      <Feedback state={state} />
      <button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add'}
      </button>
    </form>
  )
}

export function CategoryRow({ category }: { category: { id: string; name: string } }) {
  const [renameState, renameFormAction, renaming] = useActionState(renameCategoryAction, INITIAL)
  const [archiveState, archiveFormAction, archiving] = useActionState(archiveCategoryAction, INITIAL)

  return (
    <li className="settings__row">
      <form action={renameFormAction}>
        <input type="hidden" name="categoryId" value={category.id} />
        <input name="name" type="text" defaultValue={category.name} aria-label="Category name" />
        <button type="submit" disabled={renaming}>
          {renaming ? 'Renaming…' : 'Rename'}
        </button>
      </form>
      <form action={archiveFormAction}>
        <input type="hidden" name="categoryId" value={category.id} />
        <button type="submit" disabled={archiving}>
          {archiving ? 'Archiving…' : 'Archive'}
        </button>
      </form>
      <Feedback state={renameState} />
      <Feedback state={archiveState} />
    </li>
  )
}
