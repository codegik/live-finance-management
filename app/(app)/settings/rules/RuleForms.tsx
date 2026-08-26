'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { sortByName } from '@/lib/utils'
import type { SettingsState } from '../categories/state'
import { createRuleAction, deleteRuleAction } from './actions'

const INITIAL: SettingsState = { error: null, message: null }

/**
 * The forms live here, not on the page, because a `(prevState, formData)`
 * action cannot be handed to a bare `<form action={...}>`: React calls a bare
 * form action with FormData as its only argument, so the action would run
 * with prevState = FormData and formData = undefined. useActionState is what
 * supplies the previous state and makes the returned error and the
 * "N transactions recategorized" count renderable at all.
 */
function Feedback({ state }: { state: SettingsState }) {
  return (
    <>
      {state.error ? (
        <p role="alert" className="text-sm text-neg">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="text-sm text-pos">{state.message}</p> : null}
    </>
  )
}

export function CreateRuleForm({
  categories,
  connections,
}: {
  categories: { id: string; name: string }[]
  connections: { id: string; label: string }[]
}) {
  const [state, formAction, pending] = useActionState(createRuleAction, INITIAL)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Label>
          Match
          <Select name="matchType" defaultValue="CONTAINS">
            <option value="CONTAINS">anything containing</option>
            <option value="EXACT">exactly</option>
          </Select>
        </Label>
        <Label>
          Pattern
          <Input name="pattern" type="text" required placeholder="e.g. ZAFFARI" />
        </Label>
        <Label>
          Category
          <Select name="categoryId" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {sortByName(categories).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Label>
        {/* Optional. The same descriptor can appear at more than one bank, so a
            rule can be pinned to one; the empty default matches every bank. */}
        <Label>
          Bank <span className="font-normal text-text-faint">(optional)</span>
          <Select name="connectionId" defaultValue="">
            <option value="">Any bank</option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.label}
              </option>
            ))}
          </Select>
        </Label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add rule'}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  )
}

export function DeleteRuleForm({ ruleId }: { ruleId: string }) {
  const [state, formAction, pending] = useActionState(deleteRuleAction, INITIAL)

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="ruleId" value={ruleId} />
      <Feedback state={state} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending} className="text-neg hover:bg-neg-dim/40 hover:text-neg">
        {pending ? 'Deleting…' : 'Delete'}
      </Button>
    </form>
  )
}
