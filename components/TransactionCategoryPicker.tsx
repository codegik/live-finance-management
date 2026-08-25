'use client'

import { useActionState } from 'react'
import { setTransactionCategoryAction } from '@/app/(app)/dashboard/actions'
import type { RecategorizeState } from '@/app/(app)/dashboard/state'

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

  const offered = categoryId !== null && categories.some((category) => category.id === categoryId)
  // A category the row points at but that is not offered is, by construction,
  // one listCategories excluded -- i.e. archived. Saying so is the difference
  // between "why is this greyed out" and "ah, that category is retired".
  const placeholder =
    categoryId === null ? 'A categorizar' : `${categoryName ?? 'Categoria'} (arquivada)`

  return (
    <form action={formAction} className={offered ? 'txn-cat' : 'txn-cat txn-cat--unset'}>
      <input type="hidden" name="transactionId" value={transactionId} />
      <select
        name="categoryId"
        defaultValue={offered ? categoryId : ''}
        disabled={pending}
        aria-label="Categoria deste lançamento"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
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
      {state.error ? (
        <span role="alert" className="form__error">
          {state.error}
        </span>
      ) : null}
      {state.message ? <span className="txn-cat__ok">{state.message}</span> : null}
    </form>
  )
}
