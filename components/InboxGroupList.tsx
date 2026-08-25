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

/** `2026-08-17` as `17/08`, which is how a statement is read. */
function shortDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
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
    <details className="inbox__detail">
      <summary className="inbox__group-header">
        <h2>{label}</h2>
        <span className="inbox__group-meta">
          {countLabel(group.count)} · {formatCents(group.totalCents)}
        </span>
      </summary>

      <ul className="inbox__rows">
        {group.transactions.map((transaction) => (
          <li key={transaction.id} className="inbox__row">
            <span className="inbox__row-date">{shortDate(transaction.date)}</span>
            <span className="inbox__row-desc">{transaction.description}</span>
            <span className="inbox__row-amount">{formatCents(transaction.amountCents)}</span>
            <span className="inbox__row-account">
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
        <p className="inbox__more">
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
    <form action={formAction} className="inbox__group">
      <input type="hidden" name="merchant" value={group.merchant ?? ''} />
      <GroupDetail group={group} />

      {/* A visible "Categoria" caption above a select whose first option
          already says what it is would be the same word twice on a card the
          household reads dozens of times in a row. */}
      <div className="inbox__assign">
        <select name="categoryId" required defaultValue="" aria-label="Categoria">
          <option value="" disabled>
            Escolher categoria…
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending}>
          {pending ? 'Salvando…' : 'Categorizar'}
        </button>
      </div>

      {group.merchant ? (
        <div className="inbox__rule">
          <label className="inbox__rule-toggle">
            <input
              type="checkbox"
              name="createRule"
              checked={createRule}
              onChange={(event) => setCreateRule(event.target.checked)}
            />
            Sempre categorizar este estabelecimento assim
          </label>
          {/* Collapsed with the toggle: how the rule matches is only a
              question once there is going to be a rule. */}
          {createRule ? (
            <div className="inbox__rule-fields">
              <span>Quando o estabelecimento</span>
              <select name="matchType" defaultValue="EXACT" aria-label="Como comparar o texto">
                <option value="EXACT">for exatamente</option>
                <option value="CONTAINS">contiver</option>
              </select>
              <input
                name="pattern"
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
                aria-label="Texto do estabelecimento"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {state.error ? (
        <p role="alert" className="form__error">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="form__message">{state.message}</p> : null}
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
    return <p className="empty">Nada para categorizar.</p>
  }

  return (
    <div className="inbox">
      {groups.map((group) => (
        <GroupForm key={group.merchant ?? '__none__'} group={group} categories={categories} />
      ))}
    </div>
  )
}
