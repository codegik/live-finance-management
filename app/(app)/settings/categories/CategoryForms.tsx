'use client'

import { useActionState, useState } from 'react'
import {
  CATEGORY_GROUP_LABELS,
  CATEGORY_GROUPS,
  type CategoryGroup,
} from '@/lib/domain/seed-categories'
import { archiveCategoryAction, createCategoryAction, saveCategoryAction } from './actions'
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

function GroupSelect(props: {
  name: string
  value?: CategoryGroup
  defaultValue?: CategoryGroup
  onChange?: (group: CategoryGroup) => void
}) {
  return (
    <select
      name={props.name}
      value={props.value}
      defaultValue={props.defaultValue}
      onChange={props.onChange ? (e) => props.onChange!(e.target.value as CategoryGroup) : undefined}
      aria-label="Bloco"
    >
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
    <form action={formAction} className="cat-new">
      <input
        name="name"
        type="text"
        required
        placeholder="Nova categoria — ex.: Plano de saúde"
        aria-label="Nova categoria"
      />
      <GroupSelect name="group" defaultValue="DESPESA_VARIAVEL" />
      <button type="submit" disabled={pending}>
        {pending ? 'Adicionando…' : 'Adicionar'}
      </button>
      <Feedback state={state} />
    </form>
  )
}

export function CategoryRow({
  category,
}: {
  category: { id: string; name: string; group: CategoryGroup }
}) {
  const [saveState, saveFormAction, saving] = useActionState(saveCategoryAction, INITIAL)
  const [archiveState, archiveFormAction, archiving] = useActionState(archiveCategoryAction, INITIAL)

  const [name, setName] = useState(category.name)
  const [group, setGroup] = useState<CategoryGroup>(category.group)
  const [confirmingArchive, setConfirmingArchive] = useState(false)

  // Nothing to save until something changed. A Save button that is always lit
  // on every one of twenty rows says nothing about which row you edited.
  const dirty = name.trim() !== category.name || group !== category.group

  return (
    // One form, not three. Both buttons submit it -- `formAction` on the
    // archive button overrides the form's action for that submit, so the row
    // stays a single set of fields with a single set of controls instead of
    // the three stacked forms this screen first shipped with.
    <li className="cat-row">
      <form action={saveFormAction} className="cat-row__form">
        <input type="hidden" name="categoryId" value={category.id} />

        <input
          className="cat-row__name"
          name="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Nome da categoria"
        />

        <GroupSelect name="group" value={group} onChange={setGroup} />

        <div className="cat-row__actions">
          {dirty ? (
            <button type="submit" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          ) : null}

          {/* Two steps, because archiving takes a category off every picker
              and out of every block. It is reversible in the data -- the row
              is only stamped, never deleted -- but a household that loses a
              category by mis-clicking has no way to know that. */}
          {confirmingArchive ? (
            <>
              <button
                type="submit"
                className="btn-danger"
                formAction={archiveFormAction}
                disabled={archiving}
              >
                {archiving ? 'Arquivando…' : 'Confirmar'}
              </button>
              <button
                type="button"
                className="btn-quiet"
                onClick={() => setConfirmingArchive(false)}
              >
                Cancelar
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-quiet cat-row__archive"
              onClick={() => setConfirmingArchive(true)}
            >
              Arquivar
            </button>
          )}
        </div>

        <Feedback state={saveState} />
        <Feedback state={archiveState} />
      </form>
    </li>
  )
}
