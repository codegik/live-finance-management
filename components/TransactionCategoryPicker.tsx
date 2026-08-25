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
 */
export function TransactionCategoryPicker({
  transactionId,
  categoryId,
  categories,
}: {
  transactionId: string
  categoryId: string
  categories: { id: string; name: string }[]
}) {
  const [state, formAction, pending] = useActionState(setTransactionCategoryAction, INITIAL)

  return (
    <form action={formAction} className="txn-cat">
      <input type="hidden" name="transactionId" value={transactionId} />
      <select
        name="categoryId"
        defaultValue={categoryId}
        disabled={pending}
        aria-label="Categoria deste lançamento"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
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
