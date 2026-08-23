import Link from 'next/link'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { addMonths } from '@/lib/domain/budget'
import { saoPauloPeriod } from '@/lib/domain/dates'
import { getBudgetEditorView } from '@/lib/views/budget-editor'
import { BudgetForm } from './BudgetForm'

export const dynamic = 'force-dynamic'

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const session = await requireSession().catch(toSignInOrThrow)
  const { period: requested } = await searchParams
  const period = /^\d{4}-\d{2}$/.test(requested ?? '')
    ? (requested as string)
    : saoPauloPeriod(new Date())

  const view = await getBudgetEditorView(getDb(), session.householdId, period)

  return (
    <main className="page page--narrow">
      <header className="page__header">
        <h1>Budgets · {view.period}</h1>
      </header>
      {/* The spec's month picker. Plain links and no client state, the way
          the ledger's transfer toggle works: without them the only way to
          budget another month is to hand-edit the URL, which makes
          carry-forward -- the whole reason resolveBudget exists -- something
          a household can never actually reach. */}
      <p className="month-picker">
        <Link href={`/budgets?period=${addMonths(view.period, -1)}`}>
          ← {addMonths(view.period, -1)}
        </Link>{' '}
        · <span>editing {view.period}</span> ·{' '}
        <Link href={`/budgets?period=${addMonths(view.period, 1)}`}>
          {addMonths(view.period, 1)} →
        </Link>
      </p>
      <BudgetForm period={view.period} rows={view.rows} />
    </main>
  )
}
