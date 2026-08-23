'use client'

import { useActionState } from 'react'
import { removeConnectionAction, saveAccountDaysAction } from './actions'
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

export function AccountDaysForm({
  accountId,
  dueDay,
  closingDay,
}: {
  accountId: string
  dueDay: number | null
  closingDay: number | null
}) {
  const [state, formAction, pending] = useActionState(saveAccountDaysAction, INITIAL)

  return (
    <form action={formAction} className="settings__inline">
      <input type="hidden" name="accountId" value={accountId} />
      <label>
        Due day
        <input name="dueDay" type="number" min={1} max={31} defaultValue={dueDay ?? ''} />
      </label>
      <label>
        Closing day
        <input name="closingDay" type="number" min={1} max={31} defaultValue={closingDay ?? ''} />
      </label>
      {state.error ? (
        <p role="alert" className="form__error">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="form__message">{state.message}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
