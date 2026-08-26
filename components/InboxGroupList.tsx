'use client'

import { ChevronDown } from 'lucide-react'
import { useActionState, useState } from 'react'
import { assignGroupAction } from '@/app/(app)/inbox/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { sortByName } from '@/lib/utils'
import type { AssignState } from '@/app/(app)/inbox/state'
import type { InboxGroup } from '@/lib/views/inbox'

const INITIAL: AssignState = { error: null, message: null }

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function formatCents(cents: number): string {
  return brl.format(cents / 100)
}

/**
 * The header used to read "1 · R$ 6.959,05", which says nothing: the two
 * numbers are how many uncategorized transactions this merchant has and what
 * they add up to, and neither is guessable from a middle dot. Naming the
 * count is also what tells the household that one click here settles all of
 * them at once.
 */
function countLabel(count: number): string {
  return count === 1 ? '1 lançamento' : `${count} lançamentos`
}

/**
 * `2026-08-17` as `17/08/2026`. The year is kept here, unlike the monthly
 * view: the inbox groups transactions across every synced month, so a bare
 * `17/08` is ambiguous about which August a charge landed in.
 */
function shortDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
}

/**
 * The group's header, and the rows behind its count and total.
 *
 * A native <details>, not a modal: there is nothing to decide here, only
 * something to look at, and a dialog would take the household out of the very
 * form it is deciding about. It also costs no JavaScript, keeps its own
 * open/closed state through a re-render, and is keyboard-operable without a
 * line of code.
 *
 * The whole header is the <summary>, so the merchant name is as clickable as
 * the count -- the question "what is in here?" is prompted by the name at
 * least as often as by the number.
 */
function GroupDetail({ group }: { group: InboxGroup }) {
  const label = group.merchant ?? group.sampleDescription
  const hidden = group.count - group.transactions.length

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          <h2 className="truncate text-base font-semibold">{label}</h2>
        </div>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {countLabel(group.count)} · {formatCents(group.totalCents)}
        </span>
      </summary>

      <ul className="mt-3 flex flex-col divide-y divide-border rounded-lg border border-border bg-surface-2">
        {group.transactions.map((transaction) => (
          <li
            key={transaction.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
          >
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {shortDate(transaction.date)}
            </span>
            <span className="min-w-0 flex-1 truncate">{transaction.description}</span>
            <span className="font-mono text-xs tabular-nums">
              {formatCents(transaction.amountCents)}
            </span>
            <span className="w-full text-xs text-text-faint sm:w-auto">
              {transaction.accountName}
              {transaction.last4 ? ` ···· ${transaction.last4}` : null}
            </span>
          </li>
        ))}
      </ul>

      {/* Said out loud rather than silently truncated: the header counts every
          row, so a shorter list presented as complete is how someone concludes
          the count is wrong. */}
      {hidden > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Mostrando {group.transactions.length} de {group.count}. Categorize estes e os restantes
          aparecem em seguida.
        </p>
      ) : null}
    </details>
  )
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
  // Controlled, because the toggle also decides whether the rule's fields are
  // on screen at all. Unmounting them is safe: the action falls back to the
  // merchant and to EXACT when the fields do not submit, and it reads none of
  // that unless createRule came back 'on'.
  const [createRule, setCreateRule] = useState(true)

  return (
    <Card className="rounded-xl p-4">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="merchant" value={group.merchant ?? ''} />
        <GroupDetail group={group} />

        {/* A visible "Categoria" caption above a select whose first option
            already says what it is would be the same word twice on a card the
            household reads dozens of times in a row. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="sm:flex-1">
            <Select name="categoryId" required defaultValue="" aria-label="Categoria">
              <option value="" disabled>
                Escolher categoria…
              </option>
              {sortByName(categories).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Salvando…' : 'Categorizar'}
          </Button>
        </div>

        {group.merchant ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                name="createRule"
                checked={createRule}
                onChange={(event) => setCreateRule(event.target.checked)}
                className="size-4 accent-[var(--accent)]"
              />
              Sempre categorizar este estabelecimento assim
            </label>
            {/* Collapsed with the toggle: how the rule matches is only a
                question once there is going to be a rule. */}
            {createRule ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>Quando o estabelecimento</span>
                <div className="w-40">
                  <Select
                    name="matchType"
                    defaultValue="EXACT"
                    aria-label="Como comparar o texto"
                    className="h-8 text-xs"
                  >
                    <option value="EXACT">for exatamente</option>
                    <option value="CONTAINS">contiver</option>
                  </Select>
                </div>
                <Input
                  name="pattern"
                  value={pattern}
                  onChange={(event) => setPattern(event.target.value)}
                  aria-label="Texto do estabelecimento"
                  className="h-8 flex-1 text-xs"
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {state.error ? (
          <p role="alert" className="text-sm text-neg">
            {state.error}
          </p>
        ) : null}
        {state.message ? <p className="text-sm text-pos">{state.message}</p> : null}
      </form>
    </Card>
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
    return (
      <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">
        Nada para categorizar.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <GroupForm key={group.merchant ?? '__none__'} group={group} categories={categories} />
      ))}
    </div>
  )
}
