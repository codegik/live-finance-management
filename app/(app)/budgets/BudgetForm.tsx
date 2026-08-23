'use client'

import { useActionState } from 'react'
import type { BudgetEditorRow } from '@/lib/views/budget-editor'
import { saveBudgetsAction } from './actions'
import type { BudgetState } from './state'

const INITIAL: BudgetState = { error: null, message: null }

function reais(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

/**
 * `amountCents` is the amount in force, inherited OR explicit;
 * `inheritedFrom` is null only when the row is this period's own. Own and
 * explicit is the one case that round-trips as a value.
 */
function fieldValue(row: BudgetEditorRow): { defaultValue: string } | { placeholder?: string } {
  if (row.inheritedFrom === null && row.amountCents !== null) {
    return { defaultValue: reais(row.amountCents) }
  }
  if (row.amountCents !== null) return { placeholder: reais(row.amountCents) }
  if (row.suggestionCents !== null) return { placeholder: reais(row.suggestionCents) }
  return {}
}

export function BudgetForm({ period, rows }: { period: string; rows: BudgetEditorRow[] }) {
  const [state, formAction, pending] = useActionState(saveBudgetsAction, INITIAL)

  return (
    <form action={formAction}>
      <input type="hidden" name="period" value={period} />
      <ul className="settings__list">
        {rows.map((row) => (
          <li key={row.categoryId} className="settings__row">
            <label>
              {row.categoryName}
              {/* An amount this month has ALREADY committed to -- its own
                  explicit row -- is a value; anything merely inherited or
                  merely suggested is a placeholder. The distinction is the
                  whole of this field.

                  A value submits, so a placeholder is what keeps one click on
                  Save from writing an explicit row for this period for every
                  category with an inherited budget or any spend history --
                  which would contradict "saving writes only the categories
                  actually set" and kill carry-forward, since a month with its
                  own row no longer inherits.

                  But this month's own row must round-trip. Rendered as a
                  placeholder it would submit empty, the action would read
                  empty as "clear", and editing ONE category would silently
                  delete every other budget the household had set for this
                  month. Clearing stays available -- emptying a filled field
                  still means clear. */}
              <input
                name={`amount:${row.categoryId}`}
                type="text"
                inputMode="decimal"
                {...fieldValue(row)}
              />
            </label>
            {/* Say where the number came from, so accepting it is an
                informed act rather than a shrug. */}
            <span className="budget__hint">
              {row.inheritedFrom ? `carried from ${row.inheritedFrom}` : null}
              {row.amountCents === null && row.suggestionCents !== null
                ? `suggested from ${row.monthsOfHistory} months`
                : null}
            </span>
          </li>
        ))}
      </ul>
      {state.error ? (
        <p role="alert" className="form__error">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="form__message">{state.message}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save budgets'}
      </button>
    </form>
  )
}
