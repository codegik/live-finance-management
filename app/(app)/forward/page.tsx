import Link from 'next/link'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { brl, monthLabel } from '@/lib/format'
import { getForwardView } from '@/lib/views/forward'

export const dynamic = 'force-dynamic'

export default async function ForwardPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const months = await getForwardView(getDb(), session.householdId)

  return (
    <main className="page">
      <header className="page__header">
        <div className="page__title">
          <h1>Já comprometido</h1>
          <span className="page__sub">
            Parcelas que já caíram nos próximos meses — não é projeção, é o que o banco já
            informou.
          </span>
        </div>
      </header>

      {months.map((month) => {
        const committed = month.rows.filter((row) => row.committedCents !== 0)

        return (
          <section key={month.period} className="block">
            <header className="block__header">
              <h2 className="block__title">{monthLabel(month.period)}</h2>
              <span className="block__total">{brl(month.totalCommittedCents)}</span>
              <span className="block__planned">
                <Link href={`/dashboard?period=${month.period}`}>ver o mês</Link>
              </span>
            </header>

            {committed.length === 0 && month.uncategorizedCommittedCents === 0 ? (
              // The header prints the AGGREGATE total, but the list is built
              // from rows, which exclude archived categories. Saying "nothing
              // committed" under a non-zero total contradicts the number
              // beside it; the total is the one to believe.
              month.totalCommittedCents === 0 ? (
                <p className="empty" style={{ padding: '1rem' }}>
                  Nada comprometido ainda.
                </p>
              ) : (
                <p className="empty" style={{ padding: '1rem' }}>
                  Todo o valor comprometido deste mês está numa categoria arquivada.
                </p>
              )
            ) : (
              <ul className="block__rows">
                {committed.map((row) => (
                  <li key={row.categoryId} className="row">
                    <span className="row__name">{row.categoryName}</span>
                    <span className="row__amounts">
                      {brl(row.committedCents)}
                      {row.budgetCents === null ? null : (
                        <span className="row__planned"> / {brl(row.budgetCents)}</span>
                      )}
                    </span>
                  </li>
                ))}
                {/* Committed money Pluggy could not categorize is still
                    committed. It is in the total above either way, so leaving
                    it off the list would make the total unexplainable. */}
                {month.uncategorizedCommittedCents !== 0 ? (
                  <li className="row">
                    <span className="row__name">Não categorizado</span>
                    <span className="row__amounts">
                      {brl(month.uncategorizedCommittedCents)}
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
