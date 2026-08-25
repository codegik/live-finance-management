import { TransactionCategoryPicker } from '@/components/TransactionCategoryPicker'
import { brl } from '@/lib/format'
import type { LedgerDay } from '@/lib/views/ledger'

/** Nothing to show because nothing has been synced -- not because a filter hid it. */
const NOTHING_YET = 'Nenhum lançamento ainda. Conecte um cartão para começar.'

export function TransactionList({
  days,
  categories,
  emptyMessage = NOTHING_YET,
}: {
  days: LedgerDay[]
  categories: { id: string; name: string }[]
  /**
   * Why an empty list is empty. "Connect a card to get started" is actively
   * misleading under a search that simply found nothing -- the household has
   * cards, and telling them to add one sends them to fix a problem they do
   * not have.
   */
  emptyMessage?: string
}) {
  if (days.length === 0) {
    return <p className="empty">{emptyMessage}</p>
  }

  return (
    <div className="ledger">
      {days.map((day) => (
        <section key={day.date} className="ledger__day">
          <header className="ledger__day-header">
            <h2>{day.date}</h2>
            <span>{brl(day.totalCents)}</span>
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
                {/* The category is a control, not a label. A miscategorised
                    charge is spotted while reading the statement, and that is
                    the moment to fix it -- the same picker the month view
                    uses, so there is one way to do this in the app. */}
                <TransactionCategoryPicker
                  key={item.id}
                  transactionId={item.id}
                  categoryId={item.categoryId}
                  categoryName={item.categoryName}
                  categories={categories}
                />
                <span className="ledger__amount">{brl(item.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
