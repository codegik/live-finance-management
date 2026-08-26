'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  CATEGORY_GROUP_LABELS,
  CATEGORY_GROUPS,
  type CategoryGroup,
} from '@/lib/domain/seed-categories'
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

/** A small coloured dot per block, matching the month screen's blocks. */
const DOT_CLASS: Record<CategoryGroup, string> = {
  RECEITA: 'bg-pos',
  INVESTIMENTO: 'bg-accent-blue',
  DESPESA_FIXA: 'bg-warn',
  DESPESA_VARIAVEL: 'bg-neg',
  // Never rendered: the planner iterates CATEGORY_GROUPS, which omits TRANSFER.
  TRANSFER: 'bg-muted-foreground',
}

function PlanRow({ row }: { row: BudgetEditorRow }) {
  const hint =
    row.inheritedFrom ??
    (row.amountCents === null && row.suggestionCents !== null
      ? `sugerido por ${row.monthsOfHistory} meses de histórico`
      : null)

  return (
    <li className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <label className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium">{row.categoryName}</span>
        {/* An amount this month has ALREADY committed to -- its own explicit
            row -- is a value; anything merely inherited or merely suggested is
            a placeholder. The distinction is the whole of this field.

            A value submits, so a placeholder is what keeps one click on Save
            from writing an explicit row for this period for every category
            with an inherited budget or any spend history -- which would
            contradict "saving writes only the categories actually set" and
            kill carry-forward, since a month with its own row no longer
            inherits.

            But this month's own row must round-trip. Rendered as a placeholder
            it would submit empty, the action would read empty as "clear", and
            editing ONE category would silently delete every other budget the
            household had set for this month. Clearing stays available --
            emptying a filled field still means clear. */}
        <Input
          className="w-36 text-right font-mono tabular-nums"
          name={`amount:${row.categoryId}`}
          type="text"
          inputMode="decimal"
          {...fieldValue(row)}
        />
      </label>
      {/* Say where the number came from, so accepting it is an informed act
          rather than a shrug. */}
      {hint ? (
        <span className="text-xs text-text-faint">
          {row.inheritedFrom ? `herdado de ${row.inheritedFrom}` : hint}
        </span>
      ) : null}
    </li>
  )
}

export function BudgetForm({ period, rows }: { period: string; rows: BudgetEditorRow[] }) {
  const [state, formAction, pending] = useActionState(saveBudgetsAction, INITIAL)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="period" value={period} />

      {/* Blocked the same way the month screen is blocked, and in the same
          order. A plan is read against what it produced, and two different
          orderings of the same categories turn that comparison into a
          search. */}
      {CATEGORY_GROUPS.map((group) => {
        const groupRows = rows.filter((row) => row.group === group)
        if (groupRows.length === 0) return null

        return (
          <Card key={group} className="overflow-hidden rounded-xl">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2/40 px-4 py-3">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <span
                  className={`size-2 rounded-full ${DOT_CLASS[group]}`}
                  aria-hidden="true"
                />
                {CATEGORY_GROUP_LABELS[group]}
              </h2>
              <span className="text-xs text-muted-foreground">
                {group === 'RECEITA' ? 'quanto espera receber' : 'quanto pretende gastar'}
              </span>
            </header>
            <ul className="flex flex-col divide-y divide-border px-4 py-2">
              {groupRows.map((row) => (
                <PlanRow key={row.categoryId} row={row} />
              ))}
            </ul>
          </Card>
        )
      })}

      {state.error ? (
        <p role="alert" className="text-sm text-neg">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="text-sm text-pos">{state.message}</p> : null}

      <div className="sticky bottom-4 flex justify-end">
        <Button type="submit" disabled={pending} className="shadow-lg">
          {pending ? 'Salvando…' : 'Salvar plano'}
        </Button>
      </div>
    </form>
  )
}
