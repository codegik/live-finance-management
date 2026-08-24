import Link from 'next/link'
import { MonthBlock } from '@/components/MonthBlock'
import { MonthNav } from '@/components/MonthNav'
import { MonthSummary } from '@/components/MonthSummary'
import { StaleBanner } from '@/components/StaleBanner'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { saoPauloPeriod } from '@/lib/domain/dates'
import { brl, monthLabel } from '@/lib/format'
import { getMonthView } from '@/lib/views/month'

export const dynamic = 'force-dynamic'

/**
 * Same 01..12 guard as the budget editor and the budget action: '2026-13' is
 * shaped like a period but is not one, and would reach monthBounds and 500 the
 * request. An unreadable ?period is not worth an error page.
 */
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

function stanceLabel(view: { stance: string; elapsedDays: number; daysInMonth: number }): string {
  if (view.stance === 'PAST') return 'Mês fechado'
  if (view.stance === 'FUTURE') return 'Ainda não começou · apenas parcelas já comprometidas'
  return `Dia ${view.elapsedDays} de ${view.daysInMonth}`
}

export default async function MonthPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const session = await requireSession().catch(toSignInOrThrow)
  const { period: requested } = await searchParams
  const currentPeriod = saoPauloPeriod(new Date())
  const period = PERIOD.test(requested ?? '') ? (requested as string) : currentPeriod

  const view = await getMonthView(getDb(), session.householdId, period)

  return (
    <main className="page">
      <header className="page__header">
        <div className="page__title">
          <h1>{monthLabel(view.period)}</h1>
          <span className="page__sub">{stanceLabel(view)}</span>
        </div>
        <div className="page__actions">
          {view.uncategorizedCount > 0 ? (
            <Link href="/inbox" className="badge">
              {view.uncategorizedCount} a categorizar · {brl(view.uncategorizedSpentCents)}
            </Link>
          ) : null}
          <Link href={`/budgets?period=${view.period}`} className="btn-quiet">
            Planejar este mês
          </Link>
        </div>
      </header>

      <MonthNav period={view.period} currentPeriod={currentPeriod} />

      {/* Before the numbers, not after: a stale connection means every figure
          below is under-reported, and an under-report that looks healthy is
          worse than a visible error. */}
      <StaleBanner health={view.health} />

      <MonthSummary view={view} />

      {view.groups.map((group) => (
        <MonthBlock
          key={group.group}
          group={group}
          stance={view.stance}
          // Money that belongs in this block's total but has no row to sit on
          // is attached to variable spending, the block it would otherwise
          // silently fall out of. Receita takes the same treatment for income
          // that landed on no Receita category.
          extra={
            group.group === 'DESPESA_VARIAVEL'
              ? [
                  { label: 'Não categorizado', amountCents: view.uncategorizedSpentCents },
                  { label: 'Categorias arquivadas', amountCents: view.archivedSpentCents },
                ]
              : group.group === 'RECEITA'
                ? [{ label: 'Receita não categorizada', amountCents: view.unassignedIncomeCents }]
                : undefined
          }
        />
      ))}
    </main>
  )
}
