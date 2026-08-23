'use client'

import { useActionState, useState } from 'react'
import { assignGroupAction } from '@/app/(app)/inbox/actions'
import type { AssignState } from '@/app/(app)/inbox/state'
import type { InboxGroup } from '@/lib/views/inbox'

const INITIAL: AssignState = { error: null, message: null }

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function formatCents(cents: number): string {
  return brl.format(cents / 100)
}

function GroupForm({
  group,
  categories,
}: {
  group: InboxGroup
  categories: { id: string; name: string }[]
}) {
  const [state, formAction, pending] = useActionState(assignGroupAction, INITIAL)
  const [pattern, setPattern] = useState(group.merchant ?? '')
  const label = group.merchant ?? group.sampleDescription

  return (
    <form action={formAction} className="inbox__group">
      <input type="hidden" name="merchant" value={group.merchant ?? ''} />
      <header className="inbox__group-header">
        <h2>{label}</h2>
        <span>
          {group.count} · {formatCents(group.totalCents)}
        </span>
      </header>
      <label>
        Category
        <select name="categoryId" required defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      {group.merchant ? (
        <fieldset className="inbox__rule">
          <label>
            <input type="checkbox" name="createRule" defaultChecked />
            Always categorize this merchant
          </label>
          <label>
            Pattern
            <input name="pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} />
          </label>
          <label>
            Match
            <select name="matchType" defaultValue="EXACT">
              <option value="EXACT">exactly this merchant</option>
              <option value="CONTAINS">anything containing it</option>
            </select>
          </label>
        </fieldset>
      ) : null}
      {state.error ? (
        <p role="alert" className="form__error">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="form__message">{state.message}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Categorize'}
      </button>
    </form>
  )
}

export function InboxGroupList({
  groups,
  categories,
}: {
  groups: InboxGroup[]
  categories: { id: string; name: string }[]
}) {
  if (groups.length === 0) {
    return <p className="empty">Nothing to categorize. </p>
  }

  return (
    <div className="inbox">
      {groups.map((group) => (
        <GroupForm key={group.merchant ?? '__none__'} group={group} categories={categories} />
      ))}
    </div>
  )
}
