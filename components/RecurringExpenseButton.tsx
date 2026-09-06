'use client'

import { Plus, Repeat, X } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import {
  clearRecurringExpenseAction,
  setRecurringExpenseAction,
} from '@/app/(app)/dashboard/actions'
import type { RecurringExpenseState } from '@/app/(app)/dashboard/state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

const INITIAL: RecurringExpenseState = { error: null, message: null }

/** cents → the '1234,56' a Brazilian household types, so the field prefills in
 *  the form it will be read back in. Null (variable) prefills empty. */
function reaisValue(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2).replace('.', ',')
}

type Trigger = 'glyph' | 'add' | 'edit'

/**
 * Record a repeating expense, matched to real charges the way an apelido is.
 *
 * One component, three triggers, one modal:
 *  - `glyph` sits in a charge's action cluster next to the apelido pencil and
 *    the rule wand -- "this charge repeats", seeded from the charge.
 *  - `add` is the "+ Adicionar recorrente" row under a category, seeded only
 *    with that category.
 *  - `edit` opens on a projected line to change or remove it, seeded with the
 *    definition behind the line.
 *
 * The modal reads like the apelido modal on purpose: a match type and a pattern
 * (how the charge is recognised every month), plus the name, category, amount,
 * day and cadence. An empty amount means "variável" -- the projection then uses
 * the rolling average instead of a fixed figure.
 */
export function RecurringExpenseButton({
  trigger,
  period,
  categories,
  merchant,
  defaultTitle,
  defaultCategoryId,
  defaultAmountCents,
  defaultDay,
  defaultCadence = 'MONTHLY',
  defaultMatchType = 'CONTAINS',
  existing,
}: {
  trigger: Trigger
  /** The month being looked at, stored as the recurrence's anchor. */
  period: string
  categories: { id: string; name: string }[]
  /** Normalized merchant to seed the pattern, or null when there is none. */
  merchant?: string | null
  defaultTitle?: string
  defaultCategoryId?: string | null
  defaultAmountCents?: number | null
  defaultDay?: number
  defaultCadence?: 'MONTHLY' | 'ANNUAL'
  defaultMatchType?: 'EXACT' | 'CONTAINS'
  /** In edit mode, the (matchType, pattern) already stored, so Remove targets it. */
  existing?: { matchType: 'EXACT' | 'CONTAINS'; pattern: string } | null
}) {
  const [open, setOpen] = useState(false)
  const [saveState, saveAction, saving] = useActionState(setRecurringExpenseAction, INITIAL)
  const [clearState, clearAction, clearing] = useActionState(clearRecurringExpenseAction, INITIAL)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const message = saveState.message ?? clearState.message
  useEffect(() => {
    if (message) setOpen(false)
  }, [message])

  // The glyph has no stable text to match on when the descriptor normalized
  // away; keep the cluster's shape with a disabled marker, exactly as the
  // apelido pencil does.
  if (trigger === 'glyph' && !merchant) {
    return (
      <span
        aria-hidden
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-faint opacity-40"
      >
        <Repeat className="size-4 shrink-0" />
      </span>
    )
  }

  const patternSeed = merchant ?? ''
  const error = saveState.error ?? clearState.error

  return (
    <>
      {trigger === 'add' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-1.5 px-6 py-2.5 text-left text-[0.8rem] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <Plus className="size-3.5 shrink-0" />
          Adicionar recorrente
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={trigger === 'edit' ? 'Editar recorrência' : 'Tornar recorrente'}
          title={trigger === 'edit' ? 'Editar recorrência' : 'Tornar recorrente'}
          className={
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background'
          }
        >
          <Repeat className="size-4 shrink-0" />
        </button>
      )}

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Despesa recorrente"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-border bg-popover p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold leading-snug">
                {trigger === 'edit' ? 'Editar recorrência' : 'Despesa recorrente'}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="-mr-1 -mt-1 shrink-0 rounded-md border-0 bg-transparent p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="mb-4 text-sm text-muted-foreground">
              A recorrência aparece como um lançamento previsto no mês, até um lançamento real que
              casa com o padrão chegar — aí ela some para não contar duas vezes. Deixe o valor em
              branco para uma conta que varia: a previsão usa a média dos últimos meses.
            </p>

            <form action={saveAction} className="flex flex-col gap-4">
              {/* The anchor month rides along hidden: it is the month on screen,
                  not something the household should have to type. */}
              <input type="hidden" name="period" value={period} />

              <div className="grid gap-4 sm:grid-cols-2">
                <Label>
                  Casar
                  <Select name="matchType" defaultValue={defaultMatchType}>
                    <option value="CONTAINS">tudo que contém</option>
                    <option value="EXACT">exatamente</option>
                  </Select>
                </Label>
                <Label>
                  Padrão
                  <Input
                    name="pattern"
                    type="text"
                    required
                    defaultValue={patternSeed}
                    placeholder="ex.: NETFLIX"
                  />
                </Label>
              </div>

              <Label>
                Nome
                <Input
                  name="title"
                  type="text"
                  required
                  defaultValue={defaultTitle ?? ''}
                  placeholder="ex.: Netflix"
                  autoFocus
                />
              </Label>

              <Label>
                Categoria
                <Select name="categoryId" defaultValue={defaultCategoryId ?? ''} required>
                  <option value="" disabled>
                    Escolha uma categoria
                  </option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </Label>

              <div className="grid gap-4 sm:grid-cols-3">
                <Label>
                  Valor
                  <Input
                    name="amount"
                    type="text"
                    inputMode="decimal"
                    defaultValue={reaisValue(defaultAmountCents)}
                    placeholder="variável"
                  />
                </Label>
                <Label>
                  Dia
                  <Input
                    name="dayOfMonth"
                    type="number"
                    min={1}
                    max={31}
                    required
                    defaultValue={defaultDay ?? 1}
                  />
                </Label>
                <Label>
                  Frequência
                  <Select name="cadence" defaultValue={defaultCadence}>
                    <option value="MONTHLY">mensal</option>
                    <option value="ANNUAL">anual</option>
                  </Select>
                </Label>
              </div>

              {error ? (
                <p role="alert" className="text-sm text-neg">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Salvando…' : 'Salvar recorrência'}
                </Button>
                {/* Remove is only meaningful once a definition exists; it targets
                    the stored (matchType, pattern), so it clears exactly this
                    recurrence. */}
                {trigger === 'edit' && existing ? (
                  <button
                    type="submit"
                    formAction={clearAction}
                    disabled={clearing}
                    className="text-sm text-neg underline-offset-4 hover:underline disabled:opacity-60"
                  >
                    {clearing ? 'Removendo…' : 'Remover'}
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
