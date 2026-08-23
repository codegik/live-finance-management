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
            {committed.length === 0 && month.uncategorizedCommittedCents === 0 ? (
              // The header prints the AGGREGATE total, but the list is built
              // from rows, which exclude archived categories. Saying "nothing
              // committed" under a non-zero total contradicts the number
              // beside it; the total is the one to believe.
              month.totalCommittedCents === 0 ? (
                <p className="empty">Nothing committed yet.</p>
              ) : (
                <p className="empty">
                  All of this month&rsquo;s committed money is on a category that has been
                  archived.
                </p>
              )
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
                {/* Committed money Pluggy could not categorize is still
                    committed. It is in the total above either way, so leaving
                    it off the list would make the total unexplainable. */}
                {month.uncategorizedCommittedCents !== 0 ? (
                  <li className="ledger__item">
                    <span>Uncategorized</span>
                    <span className="ledger__amount">
                      {brl.format(month.uncategorizedCommittedCents / 100)}
                    </span>
                  </li>
                ) : null}
              </ul>
            )}
          </section>
        )
      })}
    </main>
  )
}
