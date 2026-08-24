import Link from 'next/link'
import { YearGrid } from '@/components/YearGrid'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { saoPauloPeriod } from '@/lib/domain/dates'
import { getYearView } from '@/lib/views/year'

export const dynamic = 'force-dynamic'

/**
 * A four-digit year, and nothing else. `?year=abc` would reach monthBounds as
 * 'NaN-01' and 500 the request; an unreadable year falls back to this one, the
 * same way an unreadable ?period does on the month screen.
 */
function parseYear(requested: string | undefined, fallback: number): number {
  return /^\d{4}$/.test(requested ?? '') ? Number(requested) : fallback
}

export default async function YearPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const session = await requireSession().catch(toSignInOrThrow)
  const { year: requested } = await searchParams
  const currentYear = Number(saoPauloPeriod(new Date()).slice(0, 4))
  const year = parseYear(requested, currentYear)

  const view = await getYearView(getDb(), session.householdId, year)

  return (
    <main className="page">
      <header className="page__header">
        <div className="page__title">
          <h1>{year}</h1>
          <span className="page__sub">Realizado por mês · clique num valor para abrir o mês</span>
        </div>
        <div className="monthnav">
          <Link className="monthnav__arrow" href={`/year?year=${year - 1}`} aria-label="Ano anterior">
            ‹
          </Link>
          <Link className="monthnav__arrow" href={`/year?year=${year + 1}`} aria-label="Próximo ano">
            ›
          </Link>
        </div>
      </header>

      <YearGrid view={view} />
    </main>
  )
}
