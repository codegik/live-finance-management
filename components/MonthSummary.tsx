import { brl, brlSigned, percent } from '@/lib/format'
import type { MonthView } from '@/lib/views/month'

/**
 * How a headline reads against its plan. Receita and Investido are figures a
 * household wants to REACH, so falling short of the plan is not failure -- it
 * is money still to come. Despesas is a figure to stay UNDER, so passing the
 * plan is the bad direction. Saldo is judged by sign, not by a fraction of a
 * target, because a net that a bar could fill would be a net that was positive.
 */
type StatKind = 'more' | 'less' | 'net'

/** Clamped: a refund-heavy expense figure can go negative, and a plan can be 0. */
function widthPercent(actualCents: number, plannedCents: number): number {
  if (plannedCents <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((actualCents / plannedCents) * 100)))
}

/**
 * One headline figure with its plan drawn underneath it, so "what was planned"
 * and "what has happened so far" read as one picture rather than two numbers
 * the reader has to subtract in their head.
 *
 * The big figure is always the realised one. The track is the plan it is a
 * fraction of; the chip on the right is the gap that remains -- money still to
 * come, budget still available, or the amount a figure has already overrun.
 */
function Stat({
  label,
  kind,
  actualCents,
  plannedCents,
  remainingLabel,
  extraMeta,
}: {
  label: string
  kind: StatKind
  actualCents: number
  plannedCents: number
  /** What the shortfall is called while a "more is better" figure is still short. */
  remainingLabel?: string
  /** e.g. the sheet's "X% da renda" for Investido, kept alongside the plan. */
  extraMeta?: string
}) {
  const hasPlan = plannedCents > 0 || (kind === 'net' && plannedCents !== 0)
  const delta = actualCents - plannedCents

  // The big figure carries a colour only where a colour means something on its
  // own: Saldo is good or bad by its sign the moment you read it.
  const valueTone = kind === 'net' ? (actualCents < 0 ? ' stat__value--neg' : ' stat__value--pos') : ''

  let barModifier = ''
  let deltaText: string | null = null
  let deltaTone = 'stat__delta--dim'

  if (kind === 'more') {
    barModifier = actualCents >= plannedCents ? ' stat__bar--pos' : ''
    if (delta > 0) {
      deltaText = `${brlSigned(delta)} acima`
      deltaTone = 'stat__delta--pos'
    } else if (delta < 0) {
      deltaText = `${brl(plannedCents - actualCents)} ${remainingLabel ?? 'restante'}`
    }
  } else if (kind === 'less') {
    barModifier = actualCents > plannedCents ? ' stat__bar--over' : ''
    if (delta > 0) {
      deltaText = `${brlSigned(delta)} acima`
      deltaTone = 'stat__delta--neg'
    } else if (delta < 0) {
      deltaText = `${brl(plannedCents - actualCents)} disponível`
      deltaTone = 'stat__delta--pos'
    }
  } else if (delta !== 0) {
    deltaText = `${brlSigned(delta)} ${delta > 0 ? 'acima' : 'abaixo'} do plano`
    deltaTone = delta >= 0 ? 'stat__delta--pos' : 'stat__delta--neg'
  }

  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={`stat__value${valueTone}`}>{brl(actualCents)}</span>

      {/* A "more/less" figure with a plan draws the plan as the track it fills;
          Saldo and any figure with no plan skip the bar -- a plan of zero has
          no fraction to draw, and a 0% bar would look like real progress. */}
      {hasPlan && kind !== 'net' ? (
        <span className="stat__track" aria-hidden="true">
          <span
            className={`stat__bar${barModifier}`}
            style={{ width: `${widthPercent(actualCents, plannedCents)}%` }}
          />
        </span>
      ) : null}

      <span className="stat__meta">
        {hasPlan ? (
          <span className="stat__plan">
            plano {brl(plannedCents)}
            {kind !== 'net' ? ` · ${percent(actualCents / plannedCents)}` : ''}
          </span>
        ) : (
          <span className="stat__plan">sem plano</span>
        )}
        {extraMeta ? <span className="stat__plan">{extraMeta}</span> : null}
        {deltaText ? <span className={`stat__delta ${deltaTone}`}>{deltaText}</span> : null}
      </span>
    </div>
  )
}

/**
 * The four figures the household's sheet keeps at the top of every month:
 * what came in, what was set aside, what went out, and what was left -- each
 * shown against the plan it is meant to hit, so the month reads as progress
 * rather than as four bare totals.
 */
export function MonthSummary({ view }: { view: MonthView }) {
  return (
    <div className="summary">
      <Stat
        label="Receita"
        kind="more"
        actualCents={view.incomeCents}
        plannedCents={view.plannedIncomeCents}
        remainingLabel="a receber"
      />
      <Stat
        label="Investido"
        kind="more"
        actualCents={view.investedCents}
        plannedCents={view.plannedInvestedCents}
        remainingLabel="a investir"
        extraMeta={
          view.investedShareOfIncome === null
            ? undefined
            : `${percent(view.investedShareOfIncome)} da renda`
        }
      />
      <Stat
        label="Despesas"
        kind="less"
        actualCents={view.expenseCents}
        plannedCents={view.plannedExpenseCents}
      />
      <Stat
        label="Saldo"
        kind="net"
        actualCents={view.netCents}
        plannedCents={view.plannedNetCents}
      />
    </div>
  )
}
