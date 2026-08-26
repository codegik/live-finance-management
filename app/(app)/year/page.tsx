import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { YearGrid } from '@/components/YearGrid'
import { buttonVariants } from '@/components/ui/button'
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
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{year}</h1>
          <p className="text-sm text-muted-foreground">
            Realizado por mês · clique num valor para abrir o mês
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            className={buttonVariants({ variant: 'outline', size: 'icon' })}
            href={`/year?year=${year - 1}`}
            aria-label="Ano anterior"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <Link
            className={buttonVariants({ variant: 'outline', size: 'icon' })}
            href={`/year?year=${year + 1}`}
            aria-label="Próximo ano"
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </header>

      <YearGrid view={view} />
    </main>
  )
}
