'use client'

import { Sparkles, X } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import type { RulePreviewItem } from '@/lib/db/rules'
import type { BankOption } from '@/lib/views/bank-options'
import { brl } from '@/lib/format'
import { sortByName } from '@/lib/utils'
import type { SettingsState } from '../categories/state'
import {
  createRuleAction,
  deleteRuleAction,
  listRuleBankOptionsAction,
  previewRuleAction,
} from './actions'

const INITIAL: SettingsState = { error: null, message: null }

type PreviewResult = { total: number; items: RulePreviewItem[] }

/**
 * The transactions the rule being typed would catch, refreshed live as the
 * form changes. It reflects the same match logic the save runs, so what shows
 * here is what gets recategorized -- the household sees the blast radius before
 * committing to it, which is the whole reason this panel exists.
 */
function RulePreview({ loading, result }: { loading: boolean; result: PreviewResult | null }) {
  // Nothing typed yet, nothing to say -- the panel only appears once a pattern
  // is being matched.
  if (!loading && !result) return null

  const heading = !result
    ? 'Checking matches…'
    : result.total === 0
      ? 'No transactions match this pattern'
      : `${result.total} ${result.total === 1 ? 'transaction matches' : 'transactions match'}`

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{heading}</span>
        {/* A quiet marker on a re-fetch, so an already-shown list does not flash
            away to a spinner on every keystroke. */}
        {loading && result ? <span className="text-xs text-text-faint">updating…</span> : null}
      </div>
      {result && result.items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {result.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-foreground">{item.description}</span>
                <span className="truncate text-xs text-text-faint">
                  {item.date} · {item.institution} ·{' '}
                  {item.categoryName ?? 'uncategorized'}
                </span>
              </div>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {brl(item.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {result && result.total > result.items.length ? (
        <p className="text-xs text-text-faint">
          +{result.total - result.items.length} more not shown
        </p>
      ) : null}
    </div>
  )
}

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

/** Prefill for a rule created from an existing transaction. Every field stays
 *  editable; these only seed it so the common case is one click. */
export type RuleDefaults = {
  matchType?: 'CONTAINS' | 'EXACT'
  pattern?: string
  categoryId?: string
  connectionId?: string
}

export function CreateRuleForm({
  categories,
  connections,
  defaults,
}: {
  categories: { id: string; name: string }[]
  connections: { id: string; label: string }[]
  defaults?: RuleDefaults
}) {
  const [state, formAction, pending] = useActionState(createRuleAction, INITIAL)

  // Mirrors of the three fields that shape the match, so the preview can react
  // to them. The inputs stay uncontrolled (defaultValue): the native form
  // submit still reads the DOM, so this state drives ONLY the preview and never
  // the save -- one less way for the two to disagree. Seeded from `defaults`
  // when the form opens over an existing transaction.
  const [matchType, setMatchType] = useState<'CONTAINS' | 'EXACT'>(
    defaults?.matchType ?? 'CONTAINS',
  )
  const [pattern, setPattern] = useState(defaults?.pattern ?? '')
  const [connectionId, setConnectionId] = useState(defaults?.connectionId ?? '')

  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  // Every request gets a number; only the newest one may write state. A slow
  // reply for 'ZAF' must not land after 'ZAFFARI' and overwrite it.
  const requestId = useRef(0)

  useEffect(() => {
    const trimmed = pattern.trim()
    if (!trimmed) {
      // Invalidate anything in flight and clear -- an empty box previews
      // nothing, never every transaction.
      requestId.current += 1
      setPreview(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const id = (requestId.current += 1)
    // Debounced so a burst of keystrokes fires one query, not one per letter.
    const timer = setTimeout(() => {
      previewRuleAction({ matchType, pattern: trimmed, connectionId: connectionId || null })
        .then((result) => {
          if (requestId.current === id) {
            setPreview(result)
            setLoading(false)
          }
        })
        .catch(() => {
          if (requestId.current === id) setLoading(false)
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [matchType, pattern, connectionId])

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Label>
          Match
          <Select
            name="matchType"
            defaultValue={defaults?.matchType ?? 'CONTAINS'}
            onChange={(e) => setMatchType(e.target.value === 'EXACT' ? 'EXACT' : 'CONTAINS')}
          >
            <option value="CONTAINS">anything containing</option>
            <option value="EXACT">exactly</option>
          </Select>
        </Label>
        <Label>
          Pattern
          <Input
            name="pattern"
            type="text"
            required
            defaultValue={defaults?.pattern ?? ''}
            placeholder="e.g. ZAFFARI"
            onChange={(e) => setPattern(e.target.value)}
          />
        </Label>
        <Label>
          Category
          <Select name="categoryId" required defaultValue={defaults?.categoryId ?? ''}>
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
            rule can be pinned to one; the empty default matches every bank. The
            caption is one <span>, not a bare text node plus a span: the Label is
            a flex column, so two loose children would stack "Bank" and
            "(optional)" onto separate lines and push this select below Category. */}
        <Label>
          <span>
            Bank <span className="font-normal text-text-faint">(optional)</span>
          </span>
          <Select
            name="connectionId"
            defaultValue={defaults?.connectionId ?? ''}
            onChange={(e) => setConnectionId(e.target.value)}
          >
            <option value="">Any bank</option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.label}
              </option>
            ))}
          </Select>
        </Label>
      </div>
      <RulePreview loading={loading} result={preview} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add rule'}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  )
}

/**
 * The bridge the month and ledger views were missing: promote a single
 * transaction into a rule without leaving the page.
 *
 * It is one small icon on the row -- no inline form crowding the statement.
 * Tapping it opens a modal holding the very same CreateRuleForm the settings
 * page uses (same match logic, same live preview, same bank scope), seeded with
 * this transaction's merchant and its current category, so the common case
 * ("always file THIS merchant HERE") is a glance and a click. Every field stays
 * editable in the modal: shorten the pattern to unify a merchant's branches, or
 * pin the rule to one bank.
 *
 * The bank list loads on first open, not on every row render: a statement has
 * hundreds of rows and almost none of them become a rule.
 */
export function RuleFromTransaction({
  merchant,
  categoryId,
  categories,
}: {
  /** The row's normalized merchant, or null when its descriptor normalized away. */
  merchant: string | null
  /** The category the row sits in now, offered as the rule's destination. */
  categoryId: string | null
  categories: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [banks, setBanks] = useState<BankOption[] | null>(null)
  const [loadingBanks, setLoadingBanks] = useState(false)

  async function openModal() {
    // Fetch the bank list once, the first time the modal is opened.
    if (banks === null && !loadingBanks) {
      setLoadingBanks(true)
      try {
        setBanks(await listRuleBankOptionsAction())
      } catch {
        // A failed load must not wedge the modal shut: fall back to an empty
        // list, which still offers "Any bank" and lets the rule be created.
        setBanks([])
      } finally {
        setLoadingBanks(false)
      }
    }
    setOpen(true)
  }

  // Escape closes it, matching the transaction detail sheet, and the listener
  // only exists while the modal is open.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-haspopup="dialog"
        aria-label="Criar regra a partir deste lançamento"
        title="Criar regra"
        // A clean ghost glyph matching the category icon beside it, lit on
        // hover. border-0 keeps the base `button` slab out.
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        {/* shrink-0 is not optional: without it this SVG collapses to ~1px wide
            in the flex button and the icon vanishes -- the bug that hid this
            control through several redesigns. */}
        <Sparkles className="size-4 shrink-0" />
      </button>

      {open ? (
        // Bottom sheet on a phone, centred card on a wider screen -- the same
        // surface the transaction detail uses, so the two read as one app.
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Nova regra"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-border bg-popover p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold leading-snug">Nova regra</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="-mr-1 -mt-1 shrink-0 rounded-md border-0 bg-transparent p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            </div>
            {banks === null ? (
              <p className="text-sm text-text-faint">Carregando bancos…</p>
            ) : (
              <CreateRuleForm
                categories={categories}
                connections={banks}
                defaults={{
                  // A rule made from one charge most often means "and every
                  // other charge like it" -- CONTAINS is that intent; the toggle
                  // is there for the rarer exact case.
                  matchType: 'CONTAINS',
                  pattern: merchant ?? '',
                  categoryId: categoryId ?? undefined,
                }}
              />
            )}
          </div>
        </div>
      ) : null}
    </>
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
