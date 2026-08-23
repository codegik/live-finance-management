import Link from 'next/link'
import { ConnectCardButton } from '@/components/ConnectCardButton'
import { StaleBanner } from '@/components/StaleBanner'
import { TransactionList } from '@/components/TransactionList'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { getLedgerView } from '@/lib/views/ledger'

export const dynamic = 'force-dynamic'

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ transfers?: string }>
}) {
  // requireSession() throws on no session -- correct for API routes, but a
  // server component that lets that escape renders Next's generic 500 page.
  // "You're not signed in" isn't a server error; send the user to /signin
  // instead. Any other failure still propagates and surfaces as a 500.
  const session = await requireSession().catch(toSignInOrThrow)
  const { transfers } = await searchParams
  const includeExcluded = transfers === '1'

  const view = await getLedgerView(getDb(), session.householdId, { includeExcluded })

  return (
    <main className="page">
      <header className="page__header">
        <h1>Ledger</h1>
        {view.uncategorizedCount > 0 ? (
          <Link href="/inbox" className="badge">
            {view.uncategorizedCount} to categorize
          </Link>
        ) : null}
        <Link href={includeExcluded ? '/ledger' : '/ledger?transfers=1'}>
          {includeExcluded ? 'Hide transfers and income' : 'Show transfers and income'}
        </Link>
        <ConnectCardButton />
      </header>
      <StaleBanner health={view.health} />
      <TransactionList days={view.days} />
    </main>
  )
}
