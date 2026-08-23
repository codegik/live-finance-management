import type { DashboardRow } from '@/lib/views/dashboard'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function formatCents(cents: number): string {
  return brl.format(cents / 100)
}

/**
 * Exported so the three outcomes and their precedence can be tested: an
 * already-over row must not be repainted as a forecast.
 */
export function barClass(row: DashboardRow): string {
  if (row.budgetCents === null) return 'budget__bar'
  if (row.spentCents > row.budgetCents) return 'budget__bar budget__bar--over'
  // A row already over budget and a row merely forecast to go over are
  // different problems, and must not look the same.
  if (row.paceCents > row.budgetCents) return 'budget__bar budget__bar--pacing-over'
  return 'budget__bar'
}

export function BudgetTable({ rows }: { rows: DashboardRow[] }) {
  if (rows.length === 0) {
    return <p className="empty">No categories yet.</p>
  }

  return (
    <ul className="budget">
      {rows.map((row) => {
        // Clamped at both ends: a refund-heavy month makes net spend
        // negative, and a negative percentage renders as `width: -12%`.
        const pct =
          row.budgetCents && row.budgetCents > 0
            ? Math.max(0, Math.min(100, Math.round((row.spentCents / row.budgetCents) * 100)))
            : 0

        return (
          <li key={row.categoryId} className="budget__row">
            <span className="budget__name">{row.categoryName}</span>
            <span className="budget__amounts">
              {formatCents(row.spentCents)}
              {row.budgetCents === null ? (
                <span className="budget__nobudget"> · no budget</span>
              ) : (
                <> {' / '}{formatCents(row.budgetCents)}</>
              )}
            </span>
            {/* An empty track is information: a budget with nothing spent.
                A category with NO budget has nothing to be a fraction of, so
                it draws no track at all -- a 0% bar collapses the two into
                the same picture. */}
            {row.budgetCents === null ? null : (
              <span className="budget__track">
                <span className={barClass(row)} style={{ width: `${pct}%` }} />
              </span>
            )}
            {row.budgetCents === null ? null : (
              <span className="budget__pace">
                pace {formatCents(row.paceCents)}
                {row.committedCents > 0 ? (
                  <> · {formatCents(row.committedCents)} committed</>
                ) : null}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
