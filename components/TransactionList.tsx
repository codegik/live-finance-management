import type { LedgerDay } from '@/lib/views/ledger'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function formatCents(cents: number): string {
  return brl.format(cents / 100)
}

export function TransactionList({ days }: { days: LedgerDay[] }) {
  if (days.length === 0) {
    return <p className="empty">No transactions yet. Connect a card to get started.</p>
  }

  return (
    <div className="ledger">
      {days.map((day) => (
        <section key={day.date} className="ledger__day">
          <header className="ledger__day-header">
            <h2>{day.date}</h2>
            <span>{formatCents(day.totalCents)}</span>
          </header>
          <ul>
            {day.items.map((item) => (
              <li key={item.id} className="ledger__item">
                <span className="ledger__description">{item.description}</span>
                <span className="ledger__meta">
                  {/* accountLast4 is null whenever Pluggy omits the account
                      number, so join only the parts that exist -- a missing
                      last4 must not leave a dangling separator. */}
                  {[item.ownerName, item.institution, item.accountLast4]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="ledger__amount">{formatCents(item.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
