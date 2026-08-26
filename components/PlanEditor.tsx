'use client'

import { Plus } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { setCategoryBudgetAction } from '@/app/(app)/dashboard/actions'
import type { PlanState } from '@/app/(app)/dashboard/state'
import { brl } from '@/lib/format'

const INITIAL: PlanState = { error: null, message: null }

/**
 * Edits a category's plan for the month right where it is read, rather than
 * sending the household to the budget screen to change one number. Click the
 * figure, it becomes a field; focus out, it saves.
 *
 * Most rows render inside a native <details><summary>, whose default action on
 * a click is to open or close the row. Both the trigger click and every click
 * inside the field therefore call preventDefault: editing the plan must not
 * toggle the transactions panel underneath it. preventDefault on `click` (not
 * `mousedown`) leaves the input's own focus and caret placement intact.
 *
 * An emptied field clears the plan -- see setCategoryBudgetAction for why that
 * is a deletion and not a budget of zero. A value equal to what was already
 * there submits nothing: a blur that changed nothing should not revalidate
 * every screen.
 */
export function PlanEditor({
  categoryId,
  period,
  plannedCents,
}: {
  categoryId: string
  period: string
  plannedCents: number | null
}) {
  const [state, formAction] = useActionState(setCategoryBudgetAction, INITIAL)
  const [editing, setEditing] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // The value the household would type: reais with a comma, or empty for no
  // plan. Also the baseline a blur is compared against to decide whether to
  // save at all.
  const original = plannedCents === null ? '' : (plannedCents / 100).toFixed(2).replace('.', ',')

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function open(event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    setEditing(true)
  }

  function commit() {
    const next = inputRef.current?.value.trim() ?? ''
    // Nothing changed -- close without touching the server.
    if (next === original.trim()) {
      setEditing(false)
      return
    }
    // Snapshot into the form before the state change unmounts it.
    formRef.current?.requestSubmit()
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={
          plannedCents === null
            ? 'row__planned row__planned--edit row__planned--unset'
            : 'row__planned row__planned--edit'
        }
        onClick={open}
        aria-label={plannedCents === null ? 'Definir um plano para esta categoria' : 'Editar o plano'}
        title={plannedCents === null ? 'Sem plano — clique para definir' : 'Editar o plano'}
      >
        {plannedCents === null ? (
          <Plus
            className="ml-1 inline-block size-3 align-middle text-text-faint opacity-50 transition-opacity hover:opacity-100"
            aria-hidden="true"
          />
        ) : (
          ` / ${brl(plannedCents)}`
        )}
        {state.error ? (
          <span role="alert" className="form__error">
            {' '}
            {state.error}
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="row__plan-edit"
      // Keep a click on the field from toggling the <details> around it.
      onClick={(event) => event.preventDefault()}
    >
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="period" value={period} />
      <input
        ref={inputRef}
        name="amount"
        type="text"
        inputMode="decimal"
        defaultValue={original}
        placeholder="sem plano"
        aria-label="Plano desta categoria"
        className="row__plan-input"
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setEditing(false)
          }
        }}
      />
    </form>
  )
}
