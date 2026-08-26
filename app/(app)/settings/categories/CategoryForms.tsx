'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
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
        <p role="alert" className="text-sm text-neg">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="text-sm text-pos">{state.message}</p> : null}
    </>
  )
}

function GroupSelect(props: {
  name: string
  value?: CategoryGroup
  defaultValue?: CategoryGroup
  className?: string
  onChange?: (group: CategoryGroup) => void
}) {
  return (
    <Select
      name={props.name}
      value={props.value}
      defaultValue={props.defaultValue}
      onChange={props.onChange ? (e) => props.onChange!(e.target.value as CategoryGroup) : undefined}
      aria-label="Bloco"
      className={props.className}
    >
      {CATEGORY_GROUPS.map((group) => (
        <option key={group} value={group}>
          {CATEGORY_GROUP_LABELS[group]}
        </option>
      ))}
    </Select>
  )
}

export function CreateCategoryForm() {
  const [state, formAction, pending] = useActionState(createCategoryAction, INITIAL)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          className="sm:flex-1"
          name="name"
          type="text"
          required
          placeholder="Nova categoria — ex.: Plano de saúde"
          aria-label="Nova categoria"
        />
        <div className="sm:w-52">
          <GroupSelect name="group" defaultValue="DESPESA_VARIAVEL" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Adicionando…' : 'Adicionar'}
        </Button>
      </div>
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
    <li className="py-2.5 first:pt-0 last:pb-0">
      <form action={saveFormAction} className="flex flex-col gap-2">
        <input type="hidden" name="categoryId" value={category.id} />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-40 flex-1"
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Nome da categoria"
          />

          <div className="w-44">
            <GroupSelect name="group" value={group} onChange={setGroup} />
          </div>

          <div className="flex items-center gap-2">
            {dirty ? (
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar'}
              </Button>
            ) : null}

            {/* Two steps, because archiving takes a category off every picker
                and out of every block. It is reversible in the data -- the row
                is only stamped, never deleted -- but a household that loses a
                category by mis-clicking has no way to know that. */}
            {confirmingArchive ? (
              <>
                <Button
                  type="submit"
                  size="sm"
                  variant="destructive"
                  formAction={archiveFormAction}
                  disabled={archiving}
                >
                  {archiving ? 'Arquivando…' : 'Confirmar'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingArchive(false)}
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setConfirmingArchive(true)}
              >
                Arquivar
              </Button>
            )}
          </div>
        </div>

        <Feedback state={saveState} />
        <Feedback state={archiveState} />
      </form>
    </li>
  )
}
