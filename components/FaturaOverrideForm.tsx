'use client'

import { useActionState } from 'react'
import { clearFaturaOverrideAction, setFaturaOverrideAction } from '@/app/(app)/faturas/actions'
import type { OverrideState } from '@/app/(app)/faturas/state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { brl } from '@/lib/format'

const INITIAL: OverrideState = { error: null, message: null }

/** `3077247` -> `30.772,47`, so the field reloads with the value the household
 *  typed rather than a bare integer. */
function centsToInput(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Lets the household type the real total for an OPEN fatura the bank has not
 * published yet -- the figure their bank app shows. It sits under an ESTIMATE or
 * OVERRIDE row (never a BILL: once the bank's own number is in, there is nothing
 * to inform). The estimate is offered as the placeholder so the field starts
 * from what is already synced.
 */
export function FaturaOverrideForm({
  accountId,
  period,
  estimateCents,
  overrideCents,
}: {
  accountId: string
  period: string
  estimateCents: number
  overrideCents: number | null
}) {
  const [setState, setAction, saving] = useActionState(setFaturaOverrideAction, INITIAL)
  const [, clearAction, clearing] = useActionState(clearFaturaOverrideAction, INITIAL)

  return (
    <div className="flex w-full flex-col gap-1.5 border-t border-border/50 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={setAction} className="flex items-center gap-2">
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="period" value={period} />
          <span className="text-xs text-text-faint">Informar valor da fatura</span>
          <Input
            name="amount"
            inputMode="decimal"
            defaultValue={overrideCents != null ? centsToInput(overrideCents) : ''}
            placeholder={centsToInput(estimateCents)}
            className="h-8 w-32 font-mono text-sm"
            aria-label="Valor da fatura informado pelo banco"
          />
          <Button type="submit" size="sm" variant="outline" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </form>
        {overrideCents != null ? (
          <form action={clearAction}>
            <input type="hidden" name="accountId" value={accountId} />
            <input type="hidden" name="period" value={period} />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              disabled={clearing}
              className="text-text-faint hover:text-foreground"
            >
              {clearing ? 'Removendo…' : 'Remover'}
            </Button>
          </form>
        ) : null}
      </div>
      {overrideCents != null ? (
        <p className="text-xs text-text-faint">
          Sincronizado até agora: {brl(estimateCents)} · faltam{' '}
          <span className="font-medium text-warn">{brl(overrideCents - estimateCents)}</span> a
          detalhar
        </p>
      ) : null}
      {setState.error ? (
        <p role="alert" className="text-xs text-neg">
          {setState.error}
        </p>
      ) : null}
      {setState.message ? <p className="text-xs text-pos">{setState.message}</p> : null}
    </div>
  )
}
