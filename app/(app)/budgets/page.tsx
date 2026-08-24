import Link from 'next/link'
import { MonthNav } from '@/components/MonthNav'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { saoPauloPeriod } from '@/lib/domain/dates'
import { monthLabel } from '@/lib/format'
import { getBudgetEditorView } from '@/lib/views/budget-editor'
import { BudgetForm } from './BudgetForm'

export const dynamic = 'force-dynamic'

// Same 01..12 month guard as the action: '2026-13' is shaped like a period but
// is not one, and would reach monthBounds and 500 the request. An unreadable
// ?period is not worth an error page -- fall back to this month.
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const session = await requireSession().catch(toSignInOrThrow)
  const { period: requested } = await searchParams
  const currentPeriod = saoPauloPeriod(new Date())
  const period = PERIOD.test(requested ?? '') ? (requested as string) : currentPeriod

  const view = await getBudgetEditorView(getDb(), session.householdId, period)

  return (
    <main className="page">
      <header className="page__header">
        <div className="page__title">
          <h1>Plano · {monthLabel(view.period)}</h1>
          <span className="page__sub">
            Um valor em branco herda o mês anterior. Salvar grava só o que você preencheu.
          </span>
        </div>
        <Link href={`/dashboard?period=${view.period}`} className="btn-quiet">
          Ver o mês
        </Link>
      </header>

      {/* The spec's month picker. Without it the only way to plan another
          month is to hand-edit the URL, which makes carry-forward -- the whole
          reason resolveBudget exists -- something a household never reaches. */}
      <MonthNav period={view.period} currentPeriod={currentPeriod} basePath="/budgets" />

      <BudgetForm period={view.period} rows={view.rows} />
    </main>
  )
}
