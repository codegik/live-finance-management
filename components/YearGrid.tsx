import Link from 'next/link'
import { MORE_IS_BETTER } from '@/lib/domain/seed-categories'
import { brl, brlCompact, monthShort } from '@/lib/format'
import type { YearCell, YearView } from '@/lib/views/year'

/**
 * How one cell reads against its plan, as a Tailwind text tone. Same rule as
 * the month screen's `rowTone`, minus the forecast: a grid cell has no room to
 * distinguish "over" from "heading over", and twelve columns of amber would say
 * nothing. A zero reads faint, a good outcome green, an overrun red.
 */
export function cellClass(cell: YearCell, moreIsBetter: boolean): string {
  if (cell.actualCents === 0) return 'text-text-faint'
  if (cell.plannedCents === null || cell.plannedCents === 0) return ''
  const beat = cell.actualCents > cell.plannedCents
  if (!beat) return moreIsBetter ? '' : 'text-pos'
  return moreIsBetter ? 'text-pos' : 'text-neg'
}

function cellTitle(cell: YearCell): string {
  if (cell.plannedCents === null) return `${brl(cell.actualCents)} · sem plano`
  const delta = cell.actualCents - cell.plannedCents
  return `${brl(cell.actualCents)} de ${brl(cell.plannedCents)} planejado · ${
    delta === 0 ? 'no plano' : `${delta > 0 ? '+' : '−'}${brl(Math.abs(delta))}`
  }`
}

/**
 * The household's sheet: categories down, months across.
 *
 * Every cell links to that month on the month screen, so the grid is a way in
 * rather than a dead end -- spotting the month a category drifted is only half
 * the question, and the other half is which transactions did it.
 *
 * Amounts are rounded to whole reais here and only here. Twelve columns of
 * centavos do not fit a laptop, let alone a phone, and the exact figure is one
 * hover (or one click) away.
 */
export function YearGrid({ view }: { view: YearView }) {
  const { periods } = view

  const summary: { label: string; values: number[]; tone?: 'net' }[] = [
    { label: 'Receita', values: view.incomeByMonth },
    { label: 'Investido', values: view.investedByMonth },
    { label: 'Despesas', values: view.expenseByMonth },
    { label: 'Saldo', values: view.netByMonth, tone: 'net' },
  ]

  const now = 'bg-accent-blue/10'
  const numCell = 'px-3 py-1.5 text-right font-mono text-xs tabular-nums'
  const labelCell =
    'sticky left-0 z-10 bg-card px-3 py-1.5 text-left text-xs font-medium'

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className={`${labelCell} text-muted-foreground`}>Categoria</th>
            {periods.map((period, i) => (
              <th
                key={period}
                className={`px-3 py-2 text-right text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground ${
                  i === view.currentIndex ? now : ''
                }`}
              >
                {monthShort(period)}
              </th>
            ))}
            <th className="px-3 py-2 text-right text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
              Total
            </th>
          </tr>
        </thead>

        <tbody className="border-b border-border">
          {summary.map((line) => (
            <tr key={line.label} className="bg-surface-2/40 font-medium">
              <th className={`${labelCell} bg-surface-2/40`} scope="row">
                {line.label}
              </th>
              {line.values.map((value, i) => (
                <td
                  key={periods[i]}
                  className={[
                    numCell,
                    i === view.currentIndex ? now : '',
                    // Saldo is coloured by sign, not against a plan: a month
                    // that spent more than it earned needs no comparison to be
                    // bad news.
                    line.tone === 'net' && value !== 0
                      ? value < 0
                        ? 'text-neg'
                        : 'text-pos'
                      : '',
                    value === 0 ? 'text-text-faint' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {brlCompact(value)}
                </td>
              ))}
              <td className={`${numCell} font-semibold`}>
                {brlCompact(line.values.reduce((sum, value) => sum + value, 0))}
              </td>
            </tr>
          ))}
        </tbody>

        {view.groups.map((group) => {
          const moreIsBetter = MORE_IS_BETTER[group.group]
          // A block with no history and no plan anywhere in the year is noise:
          // twelve dashes and a name. Blocks the household actually uses stay,
          // even in a month where nothing happened.
          const used =
            group.totalActualCents !== 0 ||
            group.rows.some((row) => row.totalPlannedCents !== 0)
          if (!used) return null

          return (
            <tbody key={group.group} className="border-b border-border">
              <tr className="bg-surface-2/60 font-semibold">
                <th className={`${labelCell} bg-surface-2/60`} scope="rowgroup">
                  {group.label}
                </th>
                {group.actualByMonth.map((value, i) => (
                  <td
                    key={periods[i]}
                    className={`${numCell} ${i === view.currentIndex ? now : ''}`}
                  >
                    {brlCompact(value)}
                  </td>
                ))}
                <td className={numCell}>{brlCompact(group.totalActualCents)}</td>
              </tr>

              {group.rows.map((row) => (
                <tr key={row.categoryId} className="transition-colors hover:bg-surface-2/40">
                  <th className={`${labelCell} font-normal text-foreground`} scope="row">
                    {row.categoryName}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td
                      key={cell.period}
                      className={[
                        numCell,
                        cellClass(cell, moreIsBetter),
                        i === view.currentIndex ? now : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={cellTitle(cell)}
                    >
                      <Link
                        className="text-inherit hover:underline"
                        href={`/dashboard?period=${cell.period}`}
                      >
                        {brlCompact(cell.actualCents)}
                      </Link>
                    </td>
                  ))}
                  <td className={numCell}>{brlCompact(row.totalActualCents)}</td>
                </tr>
              ))}
            </tbody>
          )
        })}

        {/* Spend no row above accounts for. Drawn last and named, rather than
            dropped, so the category rows and the Despesas line add up. */}
        {view.unallocatedByMonth.some((value) => value !== 0) ? (
          <tbody>
            <tr className="hover:bg-surface-2/40">
              <th className={`${labelCell} font-normal text-foreground`} scope="row">
                Não categorizado / arquivado
              </th>
              {view.unallocatedByMonth.map((value, i) => (
                <td
                  key={periods[i]}
                  className={`${numCell} ${value === 0 ? 'text-text-faint' : ''} ${
                    i === view.currentIndex ? now : ''
                  }`}
                >
                  {brlCompact(value)}
                </td>
              ))}
              <td className={numCell}>
                {brlCompact(view.unallocatedByMonth.reduce((sum, v) => sum + v, 0))}
              </td>
            </tr>
          </tbody>
        ) : null}
      </table>
    </div>
  )
}
