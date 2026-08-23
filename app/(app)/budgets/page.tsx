import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
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
      <BudgetForm period={view.period} rows={view.rows} />
    </main>
  )
}
