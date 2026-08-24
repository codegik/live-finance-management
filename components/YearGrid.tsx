import Link from 'next/link'
import { MORE_IS_BETTER } from '@/lib/domain/seed-categories'
import { brl, brlCompact, monthShort } from '@/lib/format'
import type { YearCell, YearView } from '@/lib/views/year'

/**
 * How one cell reads against its plan. Same rule as the month screen's
 * `rowTone`, minus the forecast: a grid cell has no room to distinguish "over"
 * from "heading over", and twelve columns of amber would say nothing.
 */
export function cellClass(cell: YearCell, moreIsBetter: boolean): string {
  if (cell.actualCents === 0) return 'grid__zero'
  if (cell.plannedCents === null || cell.plannedCents === 0) return ''
  const beat = cell.actualCents > cell.plannedCents
  if (!beat) return moreIsBetter ? '' : 'grid__under'
  return moreIsBetter ? 'grid__under' : 'grid__over'
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

  return (
    <div className="grid-scroll">
      <table className="grid">
        <thead>
          <tr>
            <th className="grid__label">Categoria</th>
            {periods.map((period, i) => (
              <th key={period} className={i === view.currentIndex ? 'grid__now' : undefined}>
                {monthShort(period)}
              </th>
            ))}
            <th>Total</th>
          </tr>
        </thead>

        <tbody>
          {summary.map((line) => (
            <tr key={line.label} className="grid__total">
              <th className="grid__label" scope="row">
                {line.label}
              </th>
              {line.values.map((value, i) => (
                <td
                  key={periods[i]}
                  className={[
                    i === view.currentIndex ? 'grid__now' : '',
                    // Saldo is coloured by sign, not against a plan: a month
                    // that spent more than it earned needs no comparison to be
                    // bad news.
                    line.tone === 'net' && value !== 0 ? (value < 0 ? 'grid__over' : 'grid__under') : '',
                    value === 0 ? 'grid__zero' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {brlCompact(value)}
                </td>
              ))}
              <td>{brlCompact(line.values.reduce((sum, value) => sum + value, 0))}</td>
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
            <tbody key={group.group}>
              <tr className="grid__group">
                <th className="grid__label" scope="rowgroup">
                  {group.label}
                </th>
                {group.actualByMonth.map((value, i) => (
                  <td key={periods[i]} className={i === view.currentIndex ? 'grid__now' : undefined}>
                    {brlCompact(value)}
                  </td>
                ))}
                <td>{brlCompact(group.totalActualCents)}</td>
              </tr>

              {group.rows.map((row) => (
                <tr key={row.categoryId}>
                  <th className="grid__label" scope="row">
                    {row.categoryName}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td
                      key={cell.period}
                      className={[
                        'grid__cell',
                        cellClass(cell, moreIsBetter),
                        i === view.currentIndex ? 'grid__now' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={cellTitle(cell)}
                    >
                      <Link href={`/dashboard?period=${cell.period}`}>
                        {brlCompact(cell.actualCents)}
                      </Link>
                    </td>
                  ))}
                  <td>{brlCompact(row.totalActualCents)}</td>
                </tr>
              ))}
            </tbody>
          )
        })}

        {/* Spend no row above accounts for. Drawn last and named, rather than
            dropped, so the category rows and the Despesas line add up. */}
        {view.unallocatedByMonth.some((value) => value !== 0) ? (
          <tbody>
            <tr>
              <th className="grid__label" scope="row">
                Não categorizado / arquivado
              </th>
              {view.unallocatedByMonth.map((value, i) => (
                <td key={periods[i]} className={value === 0 ? 'grid__zero' : undefined}>
                  {brlCompact(value)}
                </td>
              ))}
              <td>{brlCompact(view.unallocatedByMonth.reduce((sum, v) => sum + v, 0))}</td>
            </tr>
          </tbody>
        ) : null}
      </table>
    </div>
  )
}
