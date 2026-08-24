import { brl, percent } from '@/lib/format'
import type { MonthView } from '@/lib/views/month'

function Stat({
  label,
  value,
  meta,
  tone,
}: {
  label: string
  value: string
  meta?: string
  tone?: 'pos' | 'neg'
}) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={`stat__value${tone ? ` stat__value--${tone}` : ''}`}>{value}</span>
      {meta ? <span className="stat__meta">{meta}</span> : null}
    </div>
  )
}

/**
 * The four figures the household's sheet keeps at the top of every month:
 * what came in, what was set aside, what went out, and what was left.
 *
 * Saldo is the only one that is coloured, and it is coloured by sign rather
 * than against a plan: a month that spent more than it earned is the one fact
 * on this screen that needs no comparison to be bad news.
 */
export function MonthSummary({ view }: { view: MonthView }) {
  return (
    <div className="summary">
      <Stat
        label="Receita"
        value={brl(view.incomeCents)}
        meta={view.plannedIncomeCents > 0 ? `plano ${brl(view.plannedIncomeCents)}` : undefined}
      />
      <Stat
        label="Investido"
        value={brl(view.investedCents)}
        meta={
          view.investedShareOfIncome === null
            ? view.plannedInvestedCents > 0
              ? `plano ${brl(view.plannedInvestedCents)}`
              : undefined
            : `${percent(view.investedShareOfIncome)} da renda`
        }
      />
      <Stat
        label="Despesas"
        value={brl(view.expenseCents)}
        meta={view.plannedExpenseCents > 0 ? `plano ${brl(view.plannedExpenseCents)}` : undefined}
      />
      <Stat
        label="Saldo"
        value={brl(view.netCents)}
        tone={view.netCents < 0 ? 'neg' : 'pos'}
        meta={`plano ${brl(view.plannedNetCents)}`}
      />
    </div>
  )
}
