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
    return (
      <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {days.map((day) => (
        <section key={day.date} className="flex flex-col">
          <header className="sticky top-0 z-10 mb-1 flex items-center justify-between gap-2 border-b border-border bg-background/85 py-2 backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {day.date}
            </h2>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {brl(day.totalCents)}
            </span>
          </header>
          <ul className="flex flex-col">
            {day.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 py-3 last:border-b-0"
              >
                <div className="flex min-w-0 flex-[2] basis-56 flex-col">
                  <span className="truncate text-sm font-medium">{item.description}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {/* accountLast4 is null whenever Pluggy omits the account
                        number, so join only the parts that exist -- a missing
                        last4 must not leave a dangling separator. */}
                    {[item.ownerName, item.institution, item.accountLast4]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
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
                <span className="ml-auto shrink-0 font-mono text-sm tabular-nums">
                  {brl(item.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
