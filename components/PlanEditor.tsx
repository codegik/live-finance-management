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
        // A plan figure that reads as text until you go to change it: the base
        // <button> chrome is stripped (appearance/border/padding/background) and
        // it matches the spent figure beside it (mono, same size and weight) so
        // the two read as one "spent / planned" line. Italic when unset.
        className={`inline cursor-text appearance-none border-0 bg-transparent p-0 font-mono text-[0.875rem] font-medium text-text-faint hover:text-foreground hover:underline hover:[text-underline-offset:2px] focus-visible:text-foreground focus-visible:underline focus-visible:[text-underline-offset:2px] ${
          plannedCents === null ? 'italic' : ''
        }`}
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
          // Non-breaking spaces, not plain ones: this button is inline-block,
          // so a leading normal space is trimmed away while the one after the
          // slash survives -- which is what made "R$ 4.601,05/ R$ 5.000,00"
          // sit lopsided against its slash. A NBSP is a real character and is
          // kept, so the separator reads evenly on both sides.
          ` / ${brl(plannedCents)}`
        )}
        {state.error ? (
          <span role="alert" className="text-[0.82rem] text-neg">
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
      className="inline"
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
        className="w-[6.5rem] rounded-[4px] border border-border bg-surface-2 px-[0.35rem] py-[0.05rem] text-right font-mono text-[0.875rem] text-foreground focus:border-accent-blue focus:outline-none"
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
