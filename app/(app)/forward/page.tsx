import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { getForwardView } from '@/lib/views/forward'

export const dynamic = 'force-dynamic'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function ForwardPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const months = await getForwardView(getDb(), session.householdId)

  return (
    <main className="page">
      <header className="page__header">
        <h1>Forward</h1>
      </header>
      {months.map((month) => {
        const committed = month.rows.filter((row) => row.committedCents !== 0)

        return (
          <section key={month.period} className="ledger__day">
            <header className="ledger__day-header">
              <h2>{month.period}</h2>
              <span>{brl.format(month.totalCommittedCents / 100)} committed</span>
            </header>
            {committed.length === 0 ? (
              <p className="empty">Nothing committed yet.</p>
            ) : (
              <ul>
                {committed.map((row) => (
                  <li key={row.categoryId} className="ledger__item">
                    <span>{row.categoryName}</span>
                    <span className="ledger__amount">
                      {brl.format(row.committedCents / 100)}
                      {row.budgetCents === null
                        ? null
                        : ` of ${brl.format(row.budgetCents / 100)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </main>
  )
}
