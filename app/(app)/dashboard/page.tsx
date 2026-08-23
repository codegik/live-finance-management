import Link from 'next/link'
import { BudgetTable } from '@/components/BudgetTable'
import { StaleBanner } from '@/components/StaleBanner'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { getDashboardView } from '@/lib/views/dashboard'

export const dynamic = 'force-dynamic'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function DashboardPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const view = await getDashboardView(getDb(), session.householdId)

  return (
    <main className="page">
      <header className="page__header">
        <h1>{view.period}</h1>
        <span>
          {brl.format(view.totalSpentCents / 100)} of {brl.format(view.totalBudgetCents / 100)}
        </span>
      </header>
      {/* Before the numbers, not after: a stale connection means every figure
          below is under-reported, and an under-report that looks healthy is
          worse than a visible error. */}
      <StaleBanner health={view.health} />
      {view.uncategorizedCount > 0 ? (
        <Link href="/inbox" className="badge">
          {view.uncategorizedCount} uncategorized · {brl.format(view.uncategorizedSpentCents / 100)}
        </Link>
      ) : null}
      <BudgetTable rows={view.rows} />
      <p>
        <Link href="/budgets">Edit budgets</Link> · <Link href="/forward">Forward view</Link>
      </p>
    </main>
  )
}
