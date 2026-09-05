import Link from 'next/link'
import { MonthBlock } from '@/components/MonthBlock'
import { MonthNav } from '@/components/MonthNav'
import { MonthSummary } from '@/components/MonthSummary'
import { PendingFaturaSection } from '@/components/PendingFaturaSection'
import { StaleBanner } from '@/components/StaleBanner'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { listCategories } from '@/lib/db/categories'
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
  if (view.stance === 'FUTURE')
    return 'Ainda a vencer · compras já feitas que só serão pagas neste mês'
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

  const db = getDb()
  const [view, categories] = await Promise.all([
    getMonthView(db, session.householdId, period),
    // For the inline category picker on each transaction. Live categories
    // only: an archived one is a legitimate place for old spend to sit, but
    // never a place to move spend to.
    listCategories(db, session.householdId),
  ])

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold capitalize tracking-tight">
            {monthLabel(view.period)}
          </h1>
          <p className="text-sm text-muted-foreground">{stanceLabel(view)}</p>
        </div>
        <div className="flex items-center gap-2">
          {view.uncategorizedCount > 0 ? (
            <Link href="/inbox">
              <Badge variant="warn">
                {view.uncategorizedCount} a categorizar · {brl(view.uncategorizedSpentCents)}
              </Badge>
            </Link>
          ) : null}
          <Link
            href={`/budgets?period=${view.period}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
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
          period={view.period}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          // Money that belongs in this block's total but has no row to sit on
          // is attached to variable spending, the block it would otherwise
          // silently fall out of. Receita takes the same treatment for income
          // that landed on no Receita category.
          extra={
            group.group === 'DESPESA_VARIAVEL'
              ? [
                  {
                    label: 'Não categorizado',
                    amountCents: view.uncategorizedSpentCents,
                    ...view.uncategorizedDetail,
                  },
                  {
                    label: 'Categorias arquivadas',
                    amountCents: view.archivedSpentCents,
                    ...view.archivedDetail,
                  },
                ]
              : group.group === 'RECEITA'
                ? [
                    {
                      label: 'Receita não categorizada',
                      amountCents: view.unassignedIncomeCents,
                      ...view.unassignedIncomeDetail,
                    },
                  ]
                : undefined
          }
        />
      ))}

      {/* Below the category blocks: spend on faturas the household informed by
          hand that the transactions have not caught up to. Only when there is
          any, so a household that never overrides never sees it. */}
      {view.pendingFaturaCents > 0 ? (
        <PendingFaturaSection
          totalCents={view.pendingFaturaCents}
          lines={view.pendingFaturaLines}
        />
      ) : null}
    </main>
  )
}
