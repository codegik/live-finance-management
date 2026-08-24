import { brl, brlSigned, percent } from '@/lib/format'
import { MORE_IS_BETTER } from '@/lib/domain/seed-categories'
import type { MonthGroupView, MonthRow, MonthStance } from '@/lib/views/month'

const TITLE_CLASS: Record<string, string> = {
  RECEITA: 'block__title--receita',
  INVESTIMENTO: 'block__title--investimento',
  DESPESA_FIXA: 'block__title--fixa',
  DESPESA_VARIAVEL: 'block__title--variavel',
}

export type RowTone = 'plain' | 'good' | 'over' | 'pacing-over'

/**
 * How a row reads against its plan. Exported so the four outcomes and their
 * precedence can be tested without rendering: a row already over its plan must
 * never be repainted as a forecast, and a row in a block where MORE_IS_BETTER
 * must never be painted as a failure for beating it.
 *
 * `stance` matters because a forecast is only meaningful while the month is
 * still running. Pacing a closed month would warn about spending that
 * provably never happened.
 */
export function rowTone(row: MonthRow, stance: MonthStance): RowTone {
  if (row.plannedCents === null) return 'plain'

  if (MORE_IS_BETTER[row.group]) {
    return row.actualCents >= row.plannedCents ? 'good' : 'plain'
  }

  if (row.actualCents > row.plannedCents) return 'over'
  // A row already over and a row merely forecast to go over are different
  // problems and must not look the same.
  if (stance === 'CURRENT' && row.paceCents > row.plannedCents) return 'pacing-over'
  return 'plain'
}

const BAR_CLASS: Record<RowTone, string> = {
  plain: 'track__bar',
  good: 'track__bar track__bar--pos',
  over: 'track__bar track__bar--over',
  'pacing-over': 'track__bar track__bar--pacing-over',
}

const DELTA_CLASS: Record<RowTone, string> = {
  plain: 'row__delta',
  good: 'row__delta row__delta--under',
  over: 'row__delta row__delta--over',
  'pacing-over': 'row__delta row__delta--pace',
}

/**
 * Clamped at both ends. A refund-heavy month makes net spend negative, and a
 * negative percentage renders as `width: -12%`.
 */
function widthPercent(actualCents: number, plannedCents: number): number {
  if (plannedCents <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((actualCents / plannedCents) * 100)))
}

function Row({ row, stance }: { row: MonthRow; stance: MonthStance }) {
  const tone = rowTone(row, stance)
  const planned = row.plannedCents
  const delta = planned === null ? null : row.actualCents - planned

  return (
    <li className="row">
      <span className="row__name">{row.categoryName}</span>
      <span className="row__amounts">
        {brl(row.actualCents)}
        {planned === null ? (
          <span className="row__planned"> · sem plano</span>
        ) : (
          <span className="row__planned"> / {brl(planned)}</span>
        )}
      </span>

      {/* An empty track is information: a plan with nothing against it yet. A
          row with NO plan has nothing to be a fraction of, so it draws no
          track at all -- a 0% bar would collapse the two into one picture. */}
      {planned === null ? null : (
        <span className="track">
          <span
            className={BAR_CLASS[tone]}
            style={{ width: `${widthPercent(row.actualCents, planned)}%` }}
          />
          {/* Where the month is heading, marked only while it is still
              running and only when it lands inside the track. */}
          {stance === 'CURRENT' && row.paceCents > row.actualCents ? (
            <span
              className="track__pace"
              style={{ left: `${widthPercent(row.paceCents, planned)}%` }}
              title={`Projeção: ${brl(row.paceCents)}`}
            />
          ) : null}
        </span>
      )}

      <span className="row__meta">
        {delta !== null && delta !== 0 ? (
          <span className={DELTA_CLASS[tone]}>{brlSigned(delta)}</span>
        ) : null}
        {stance === 'CURRENT' && planned !== null && row.paceCents !== row.actualCents ? (
          <span>projeção {brl(row.paceCents)}</span>
        ) : null}
        {row.committedCents > 0 ? <span>{brl(row.committedCents)} já comprometido</span> : null}
        {row.plannedFrom ? <span>plano herdado de {row.plannedFrom}</span> : null}
      </span>
    </li>
  )
}

/**
 * One block of the household's sheet -- Receita, Investimento, Despesas fixas,
 * Despesas variáveis -- with its own subtotal, the way the spreadsheet has
 * always had one.
 *
 * `extra` carries money that belongs to this block's total but has no category
 * to sit on: uncategorized spend, and spend on categories since archived. It
 * is passed in rather than hidden, because a block whose rows do not add up to
 * its own header is a block nobody can reconcile.
 */
export function MonthBlock({
  group,
  stance,
  extra,
}: {
  group: MonthGroupView
  stance: MonthStance
  extra?: { label: string; amountCents: number }[]
}) {
  const extras = (extra ?? []).filter((item) => item.amountCents !== 0)
  const total = group.actualCents + extras.reduce((sum, item) => sum + item.amountCents, 0)

  if (group.rows.length === 0 && extras.length === 0) return null

  return (
    <section className="block">
      <header className="block__header">
        <h2 className={`block__title ${TITLE_CLASS[group.group] ?? ''}`}>{group.label}</h2>
        <span className="block__total">{brl(total)}</span>
        <span className="block__planned">
          {group.plannedCents > 0 ? (
            <>
              de {brl(group.plannedCents)} · {percent(total / group.plannedCents)}
            </>
          ) : (
            'sem plano'
          )}
        </span>
      </header>
      <ul className="block__rows">
        {group.rows.map((row) => (
          <Row key={row.categoryId} row={row} stance={stance} />
        ))}
        {extras.map((item) => (
          <li key={item.label} className="row">
            <span className="row__name">{item.label}</span>
            <span className="row__amounts">{brl(item.amountCents)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
