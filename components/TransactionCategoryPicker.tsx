'use client'

import { ChevronDown, Tag, TriangleAlert } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { setTransactionCategoryAction } from '@/app/(app)/dashboard/actions'
import type { RecategorizeState } from '@/app/(app)/dashboard/state'
import { cn } from '@/lib/utils'

const INITIAL: RecategorizeState = { error: null, message: null }

/**
 * Corrects one transaction's category where it is being read, rather than
 * sending the household to another screen to do it.
 *
 * Submits on change, with no confirm button: the select IS the decision, and
 * the result is visible without a message because the row leaves the category
 * it was wrong in and appears under the one it was moved to.
 *
 * `key` on the form matters. After the move, the server re-renders this list
 * without the row; React reuses DOM where it can, and without a key tied to
 * the transaction a stale select can end up attached to a different row.
 *
 * Resting state is a tag chip, not an always-open dropdown: a column of live
 * selects is heavy to read and easy to change by mistake. Clicking the chip
 * reveals the select, focused; choosing submits and it collapses back. The
 * uncategorized chip is amber with a warning glyph, so "needs a category" is
 * still visible down the column at a glance.
 *
 * `categoryId` may be a category that is not among the options, in two ways
 * the ledger produces and the month view does not. It can be null -- the
 * ledger lists uncategorized rows, that being the point of the inbox badge --
 * and it can name an archived category, which stays a legitimate resting
 * place for old spend but is never offered as a destination. Both cases get a
 * DISABLED placeholder option carrying the row's real state. Without one, a
 * defaultValue matching no option makes the browser show the FIRST option
 * instead, so an uncategorized charge would read as if it were already filed
 * under whatever sorts first -- a wrong answer presented with total
 * confidence. Disabled, so it cannot be chosen and an empty categoryId can
 * never be submitted.
 */
export function TransactionCategoryPicker({
  transactionId,
  categoryId,
  categoryName,
  categories,
}: {
  transactionId: string
  categoryId: string | null
  categoryName?: string | null
  categories: { id: string; name: string }[]
}) {
  const [state, formAction, pending] = useActionState(setTransactionCategoryAction, INITIAL)
  const [editing, setEditing] = useState(false)
  const selectRef = useRef<HTMLSelectElement>(null)

  // The offered category's own name, so the chip reads correctly even where the
  // caller passes no categoryName (the month view does not) -- the name is in
  // the options list it already hands us.
  const matched = categories.find((category) => category.id === categoryId)
  const offered = matched != null
  const unset = categoryId === null
  const label = unset ? 'A categorizar' : (matched?.name ?? categoryName ?? 'Categoria')
  // A category the row points at but that is not offered is, by construction,
  // one listCategories excluded -- i.e. archived.
  const placeholder = unset ? 'A categorizar' : `${categoryName ?? 'Categoria'} (arquivada)`

  useEffect(() => {
    if (editing) selectRef.current?.focus()
  }, [editing])

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Categoria: ${label}. Clique para alterar.`}
        title={label}
        className={cn(
          'inline-flex max-w-44 shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          unset
            ? 'border-warn/40 bg-warn-dim/40 text-warn hover:bg-warn-dim/60'
            : 'border-border bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground',
        )}
      >
        {unset ? (
          <TriangleAlert className="size-3.5 shrink-0" />
        ) : (
          <Tag className="size-3.5 shrink-0" />
        )}
        <span className="truncate">{label}</span>
      </button>
    )
  }

  return (
    <form action={formAction} className="flex shrink-0 items-center gap-2">
      <input type="hidden" name="transactionId" value={transactionId} />
      <div className="relative w-44">
        <select
          ref={selectRef}
          name="categoryId"
          defaultValue={offered ? (categoryId ?? '') : ''}
          disabled={pending}
          aria-label="Categoria deste lançamento"
          onChange={(event) => {
            event.currentTarget.form?.requestSubmit()
            setEditing(false)
          }}
          onBlur={() => setEditing(false)}
          className={cn(
            'h-8 w-full appearance-none rounded-md border bg-surface-2 pl-2.5 pr-7 text-xs transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            'disabled:cursor-not-allowed disabled:opacity-60',
            offered ? 'border-input text-foreground' : 'border-warn/40 bg-warn-dim/40 text-warn',
          )}
        >
          {offered ? null : (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
      {state.error ? (
        <span role="alert" className="text-xs text-neg">
          {state.error}
        </span>
      ) : null}
    </form>
  )
}
