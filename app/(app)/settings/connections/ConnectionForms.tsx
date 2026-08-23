'use client'

import { useActionState } from 'react'
import { removeConnectionAction } from './actions'
import type { ConnectionState } from './state'

const INITIAL: ConnectionState = { error: null, message: null }

/**
 * Two steps, not a confirm() dialog: removing a connection cascades to every
 * transaction it ever carried, and the count is the part worth reading before
 * clicking. Step one is a link that sets ?remove=<id>; this is step two.
 */
export function RemoveConnectionForm({
  connectionId,
  institution,
  transactionCount,
}: {
  connectionId: string
  institution: string
  transactionCount: number
}) {
  const [state, formAction, pending] = useActionState(removeConnectionAction, INITIAL)

  return (
    <form action={formAction} className="settings__confirm">
      <input type="hidden" name="connectionId" value={connectionId} />
      <p>
        Remove <strong>{institution}</strong> and delete {transactionCount} transactions? This
        cannot be undone.
      </p>
      {state.error ? (
        <p role="alert" className="form__error">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Removing…' : `Yes, delete ${transactionCount} transactions`}
      </button>
    </form>
  )
}
