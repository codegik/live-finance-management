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

// Inputs default to the household's own override, NOT the resolved
// (override ?? pluggy) value: defaulting to the resolved value would mean
// saving just one field submits Pluggy's own figure for the other field back
// as an override, permanently pinning it against every future sync. Empty
// means "no override" and shows Pluggy's value as a placeholder instead, so
// only a deliberate edit ever creates one. The line beneath the inputs always
// shows Pluggy's own value, and an "override" tag marks a field the
// household has replaced, so neither fact is ever hidden.
export function AccountDaysForm({
  accountId,
  dueDayOverride,
  closingDayOverride,
  pluggyDueDay,
  pluggyClosingDay,
  dueDayOverridden,
  closingDayOverridden,
}: {
  accountId: string
  dueDayOverride: number | null
  closingDayOverride: number | null
  pluggyDueDay: number | null
  pluggyClosingDay: number | null
  dueDayOverridden: boolean
  closingDayOverridden: boolean
}) {
  const [state, formAction, pending] = useActionState(saveAccountDaysAction, INITIAL)

  return (
    <form action={formAction} className="settings__inline">
      <input type="hidden" name="accountId" value={accountId} />
      <label>
        Due day {dueDayOverridden ? <span className="badge">override</span> : null}
        <input
          name="dueDay"
          type="number"
          min={1}
          max={31}
          defaultValue={dueDayOverride ?? ''}
          placeholder={pluggyDueDay != null ? String(pluggyDueDay) : undefined}
        />
      </label>
      <label>
        Closing day {closingDayOverridden ? <span className="badge">override</span> : null}
        <input
          name="closingDay"
          type="number"
          min={1}
          max={31}
          defaultValue={closingDayOverride ?? ''}
          placeholder={pluggyClosingDay != null ? String(pluggyClosingDay) : undefined}
        />
      </label>
      <p className="settings__meta">
        pluggy reports due day {pluggyDueDay ?? 'none'}, closing day {pluggyClosingDay ?? 'none'}
      </p>
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
