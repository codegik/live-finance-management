'use client'

import { useActionState } from 'react'
import {
  CATEGORY_GROUP_LABELS,
  CATEGORY_GROUPS,
  type CategoryGroup,
} from '@/lib/domain/seed-categories'
import {
  archiveCategoryAction,
  createCategoryAction,
  renameCategoryAction,
  setCategoryGroupAction,
} from './actions'
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

function GroupSelect({ name, defaultValue }: { name: string; defaultValue: CategoryGroup }) {
  return (
    <select name={name} defaultValue={defaultValue} aria-label="Bloco">
      {CATEGORY_GROUPS.map((group) => (
        <option key={group} value={group}>
          {CATEGORY_GROUP_LABELS[group]}
        </option>
      ))}
    </select>
  )
}

export function CreateCategoryForm() {
  const [state, formAction, pending] = useActionState(createCategoryAction, INITIAL)

  return (
    <form action={formAction} className="settings__create">
      <label>
        Nova categoria
        <input name="name" type="text" required placeholder="Ex.: Plano de saúde" />
      </label>
      <label>
        Bloco
        <GroupSelect name="group" defaultValue="DESPESA_VARIAVEL" />
      </label>
      <Feedback state={state} />
      <button type="submit" disabled={pending}>
        {pending ? 'Adicionando…' : 'Adicionar'}
      </button>
    </form>
  )
}

export function CategoryRow({
  category,
}: {
  category: { id: string; name: string; group: CategoryGroup }
}) {
  const [renameState, renameFormAction, renaming] = useActionState(renameCategoryAction, INITIAL)
  const [groupState, groupFormAction, moving] = useActionState(setCategoryGroupAction, INITIAL)
  const [archiveState, archiveFormAction, archiving] = useActionState(archiveCategoryAction, INITIAL)

  return (
    <li className="settings__row settings__row--stacked">
      <form action={renameFormAction} className="settings__inline">
        <input type="hidden" name="categoryId" value={category.id} />
        <input
          name="name"
          type="text"
          defaultValue={category.name}
          aria-label="Nome da categoria"
        />
        <button type="submit" className="btn-quiet" disabled={renaming}>
          {renaming ? 'Renomeando…' : 'Renomear'}
        </button>
      </form>

      {/* Its own form and its own button, because moving a category into or
          out of Receita changes which transactions it is totalled from -- a
          different act from fixing a spelling, and one worth confirming. */}
      <form action={groupFormAction} className="settings__inline">
        <input type="hidden" name="categoryId" value={category.id} />
        <GroupSelect name="group" defaultValue={category.group} />
        <button type="submit" className="btn-quiet" disabled={moving}>
          {moving ? 'Movendo…' : 'Mover'}
        </button>
      </form>

      <form action={archiveFormAction} className="settings__inline">
        <input type="hidden" name="categoryId" value={category.id} />
        <button type="submit" className="btn-quiet" disabled={archiving}>
          {archiving ? 'Arquivando…' : 'Arquivar'}
        </button>
      </form>

      <Feedback state={renameState} />
      <Feedback state={groupState} />
      <Feedback state={archiveState} />
    </li>
  )
}
