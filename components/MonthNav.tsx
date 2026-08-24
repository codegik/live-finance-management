import Link from 'next/link'
import { addMonths } from '@/lib/domain/budget'
import { monthShort } from '@/lib/format'

/**
 * Moving between months, which is the whole point of the screen.
 *
 * Plain links and no client state, the way the ledger's transfer toggle
 * works: the month is in the URL, so a month is shareable, bookmarkable and
 * survives a reload. The arrows deliberately cross the year boundary --
 * `addMonths` handles it -- so December and January are one step apart rather
 * than a dead end at the edge of the strip.
 */
export function MonthNav({
  period,
  currentPeriod,
  basePath = '/dashboard',
}: {
  period: string
  currentPeriod: string
  basePath?: string
}) {
  const year = period.slice(0, 4)
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)

  return (
    <div className="monthnav">
      <Link
        className="monthnav__arrow"
        href={`${basePath}?period=${addMonths(period, -1)}`}
        aria-label="Mês anterior"
      >
        ‹
      </Link>

      <div className="monthnav__strip">
        {months.map((month) => (
          <Link
            key={month}
            href={`${basePath}?period=${month}`}
            className={`monthnav__month${month === currentPeriod ? ' monthnav__month--today' : ''}`}
            aria-current={month === period ? 'page' : undefined}
          >
            {monthShort(month)}
          </Link>
        ))}
      </div>

      <Link
        className="monthnav__arrow"
        href={`${basePath}?period=${addMonths(period, 1)}`}
        aria-label="Próximo mês"
      >
        ›
      </Link>
    </div>
  )
}
