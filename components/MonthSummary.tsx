import { Card } from '@/components/ui/card'
import { brl } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { MonthView } from '@/lib/views/month'

/**
 * How a headline reads against its plan. Receita and Investido are figures a
 * household wants to REACH, so falling short of the plan is not failure -- it
 * is money still to come. Despesas is a figure to stay UNDER, so passing the
 * plan is the bad direction. Saldo is a residual, not a target -- it has no
 * plan of its own and is judged only by its sign.
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
  plannedCents = 0,
  plannedNetCents,
}: {
  label: string
  kind: StatKind
  actualCents: number
  /** Omitted for Saldo, which has no plan. */
  plannedCents?: number
  /**
   * Saldo's planned residual: what the plan expected to be left over
   * (planned income applied against the realised balance). Unlike `plannedCents`
   * it can be negative and draws no bar, so it is a Saldo-only figure the box
   * shows underneath its realised balance. Omitted when nothing is planned yet.
   */
  plannedNetCents?: number
}) {
  // Saldo is a residual and never carries a plan; the others only have one when
  // a figure was actually planned.
  const hasPlan = kind !== 'net' && plannedCents > 0

  // Every box carries a second headline: the figure the plan set for it. Saldo's
  // is the calculated residual; the others' is simply their plan. Shown only
  // once there is a plan to show, so a plan-less box stays a single figure.
  const plannedFigureCents = kind === 'net' ? plannedNetCents : hasPlan ? plannedCents : undefined
  // A residual is coloured by its sign; a plain target has no bad side, so it
  // reads in the neutral foreground -- big and bold is enough to make it stand.
  const plannedFigureTone =
    kind === 'net' ? ((plannedNetCents ?? 0) < 0 ? 'text-neg' : 'text-pos') : 'text-foreground'

  // The big figure carries a colour only where a colour means something on its
  // own: Saldo is good or bad by its sign the moment you read it.
  const valueTone = kind === 'net' ? (actualCents < 0 ? 'text-neg' : 'text-pos') : 'text-foreground'

  // The bar's colour is the only thing that still carries direction: green once
  // a "more is better" figure has met its plan, red once a "less is better" one
  // has broken it. The gap is no longer spelled out in a chip.
  let barTone = 'bg-primary'
  if (hasPlan && kind === 'more') {
    barTone = actualCents >= plannedCents ? 'bg-pos' : 'bg-primary'
  } else if (hasPlan && kind === 'less') {
    barTone = actualCents > plannedCents ? 'bg-neg' : 'bg-primary'
  }

  return (
    <Card className="flex min-w-0 flex-col gap-2 rounded-xl p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'whitespace-nowrap font-mono text-base font-semibold leading-tight tabular-nums sm:text-lg',
          valueTone,
        )}
      >
        {brl(actualCents)}
      </span>

      {/* A "more/less" figure with a plan draws the plan as the track it fills;
          a plan of zero has no fraction to draw and a 0% bar would read as real
          progress, so it is skipped. Saldo never has a bar either, but it does
          carry a planned figure below, so it reserves the bar's height with an
          empty spacer -- otherwise its "Planejado" block would ride up out of
          line with the other boxes'. */}
      {hasPlan ? (
        <span
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
          aria-hidden="true"
        >
          <span
            className={cn('block h-full rounded-full', barTone)}
            style={{ width: `${widthPercent(actualCents, plannedCents)}%` }}
          />
        </span>
      ) : kind === 'net' ? (
        <span className="h-1.5 w-full" aria-hidden="true" />
      ) : null}

      {!hasPlan && kind !== 'net' ? (
        <span className="text-xs text-text-faint">sem plano</span>
      ) : null}

      {/* Every box carries a second headline: the figure the plan set for it,
          shown with the same label + big-figure treatment as the realised one
          so the two read as a pair -- what happened vs. what was planned. */}
      {plannedFigureCents !== undefined ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Planejado
          </span>
          <span
            className={cn(
              'whitespace-nowrap font-mono text-lg font-semibold leading-tight tabular-nums sm:text-xl',
              plannedFigureTone,
            )}
          >
            {brl(plannedFigureCents)}
          </span>
        </div>
      ) : null}
    </Card>
  )
}

/**
 * The four figures the household's sheet keeps at the top of every month:
 * what came in, what was set aside, what went out, and what was left -- each
 * shown against the plan it is meant to hit, so the month reads as progress
 * rather than as four bare totals.
 */
export function MonthSummary({ view }: { view: MonthView }) {
  // The balance the plan implies: the planned income applied against where the
  // month stands right now. netCents is already the realised balance (negative
  // when the month is in deficit), so adding the planned income answers "where
  // would the balance land once the planned receita comes in?".
  // Only shown once income is actually planned -- with no plan the line would
  // just repeat the realised balance.
  const plannedNetCents =
    view.plannedIncomeCents > 0 ? view.plannedIncomeCents + view.netCents : undefined

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="Receita"
        kind="more"
        actualCents={view.incomeCents}
        plannedCents={view.plannedIncomeCents}
      />
      <Stat
        label="Investido"
        kind="more"
        actualCents={view.investedCents}
        plannedCents={view.plannedInvestedCents}
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
        plannedNetCents={plannedNetCents}
      />
    </div>
  )
}
