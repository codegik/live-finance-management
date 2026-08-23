'use client'

import { useActionState } from 'react'
import type { BudgetEditorRow } from '@/lib/views/budget-editor'
import { saveBudgetsAction } from './actions'
import type { BudgetState } from './state'

const INITIAL: BudgetState = { error: null, message: null }

function reais(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
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
              <input
                name={`amount:${row.categoryId}`}
                type="text"
                inputMode="decimal"
                defaultValue={
                  row.amountCents !== null
                    ? reais(row.amountCents)
                    : row.suggestionCents !== null
                      ? reais(row.suggestionCents)
                      : ''
                }
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
