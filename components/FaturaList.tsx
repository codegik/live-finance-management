import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { brl, monthLabel } from '@/lib/format'
import type { FaturaCard } from '@/lib/views/faturas'

/** `vence 15/09` from a `YYYY-MM-DD`. */
function dueLabel(due: string | null): string | null {
  return due ? `vence ${due.slice(8, 10)}/${due.slice(5, 7)}` : null
}

/**
 * What each card owes, fatura by fatura.
 *
 * A BILL row is the bank's own closed statement -- the number that matches the
 * app on the phone, to the centavo. An ESTIMATE row is a cycle the bank has not
 * published yet (the open one, or a future installment projection); it is summed
 * from transactions and marked "em formação", because it is missing interest,
 * IOF and fees and will move until the fatura closes. Never dressing an estimate
 * up as final is the whole point of this screen.
 */
export function FaturaList({
  cards,
  currentPeriod,
}: {
  cards: FaturaCard[]
  currentPeriod: string
}) {
  if (cards.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">
        Nenhum cartão de crédito conectado ainda.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {cards.map((card) => (
        <Card key={card.accountId} className="overflow-hidden rounded-xl">
          <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border bg-surface-2/40 px-4 py-3">
            <h2 className="text-base font-semibold">
              {card.name}
              {card.last4 ? (
                <span className="ml-1.5 font-mono text-sm text-muted-foreground">
                  ···· {card.last4}
                </span>
              ) : null}
            </h2>
            <span className="text-xs text-text-faint">{card.institution}</span>
          </header>

          {card.rows.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted-foreground">Sem faturas neste período.</p>
          ) : (
            <ul className="list-none divide-y divide-border">
              {card.rows.map((row) => {
                const isCurrent = row.period === currentPeriod
                return (
                  <li
                    key={row.period}
                    className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 ${
                      isCurrent ? 'bg-accent-dim/40' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1 text-sm font-medium capitalize">
                      {monthLabel(row.period)}
                    </span>

                    {row.source === 'BILL' ? (
                      <span className="text-xs text-text-faint">
                        fatura fechada
                        {dueLabel(row.dueDate) ? ` · ${dueLabel(row.dueDate)}` : ''}
                      </span>
                    ) : (
                      <Badge variant="warn">em formação</Badge>
                    )}

                    <span className="w-full text-right font-mono text-sm font-semibold tabular-nums sm:w-auto">
                      {brl(row.amountCents)}
                    </span>

                    {row.minimumCents != null ? (
                      <span className="basis-full text-right text-xs text-text-faint">
                        mínimo {brl(row.minimumCents)}
                      </span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      ))}
    </div>
  )
}
