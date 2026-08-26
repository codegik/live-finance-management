'use client'

import { useActionState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4"
    >
      <input type="hidden" name="connectionId" value={connectionId} />
      <p className="text-sm text-foreground">
        Remove <strong className="font-semibold">{institution}</strong> and delete{' '}
        {transactionCount} transactions? This cannot be undone.
      </p>
      {state.error ? (
        <p role="alert" className="text-sm text-neg">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" variant="destructive" size="sm" disabled={pending} className="self-start">
        {pending ? 'Removing…' : `Yes, delete ${transactionCount} transactions`}
      </Button>
    </form>
  )
}

/** A number field with its caption and an optional "override" tag. The caption
 *  row is a fixed height so the tag appearing or not never nudges the input
 *  below it out of line with its neighbour. */
function DayField({
  name,
  caption,
  overridden,
  defaultValue,
  placeholder,
}: {
  name: string
  caption: string
  overridden: boolean
  defaultValue: number | null
  placeholder: string | undefined
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-5 items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{caption}</span>
        {overridden ? <Badge variant="warn">override</Badge> : null}
      </div>
      <Input
        name={name}
        type="number"
        min={1}
        max={31}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
      />
    </div>
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
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="accountId" value={accountId} />
      <div className="grid max-w-xs grid-cols-2 gap-4">
        <DayField
          name="dueDay"
          caption="Due day"
          overridden={dueDayOverridden}
          defaultValue={dueDayOverride}
          placeholder={pluggyDueDay != null ? String(pluggyDueDay) : undefined}
        />
        <DayField
          name="closingDay"
          caption="Closing day"
          overridden={closingDayOverridden}
          defaultValue={closingDayOverride}
          placeholder={pluggyClosingDay != null ? String(pluggyClosingDay) : undefined}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        pluggy reports due day {pluggyDueDay ?? 'none'}, closing day {pluggyClosingDay ?? 'none'}
      </p>
      {state.error ? (
        <p role="alert" className="text-sm text-neg">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="text-sm text-pos">{state.message}</p> : null}
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}
