import Link from 'next/link'
import { StaleBanner } from '@/components/StaleBanner'
import { TransactionList } from '@/components/TransactionList'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { listCategories } from '@/lib/db/categories'
import { getDb } from '@/lib/db/client'
import { brl } from '@/lib/format'
import { getLedgerView } from '@/lib/views/ledger'

export const dynamic = 'force-dynamic'

/**
 * This screen's whole state lives in the URL: `?transfers=1` and `?q=`. Every
 * link and form here has to carry the OTHER one through, or using one control
 * silently resets the other -- searching would drop you back to spend-only,
 * and toggling transfers would throw away what you typed.
 */
function ledgerHref(params: { transfers: boolean; q: string }): string {
  const search = new URLSearchParams()
  if (params.transfers) search.set('transfers', '1')
  if (params.q) search.set('q', params.q)
  const query = search.toString()
  return query ? `/ledger?${query}` : '/ledger'
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ transfers?: string; q?: string }>
}) {
  // requireSession() throws on no session -- correct for API routes, but a
  // server component that lets that escape renders Next's generic 500 page.
  // "You're not signed in" isn't a server error; send the user to /signin
  // instead. Any other failure still propagates and surfaces as a 500.
  const session = await requireSession().catch(toSignInOrThrow)
  const { transfers, q } = await searchParams
  const includeExcluded = transfers === '1'
  const query = q?.trim() ?? ''

  const db = getDb()
  const [view, categories] = await Promise.all([
    getLedgerView(db, session.householdId, { includeExcluded, search: query }),
    // For the inline category picker on each row. Live categories only: an
    // archived one is a legitimate place for old spend to sit, but never a
    // place to move spend to.
    listCategories(db, session.householdId),
  ])

  return (
    <main className="page">
      <header className="page__header">
        <div className="page__title">
          <h1>Extrato</h1>
          <span className="page__sub">
            {includeExcluded
              ? 'Incluindo transferências e receitas'
              : 'Apenas gastos — transferências e receitas ocultas'}
          </span>
        </div>
        <div className="page__actions">
          {view.uncategorizedCount > 0 ? (
            <Link href="/inbox" className="badge">
              {view.uncategorizedCount} a categorizar
            </Link>
          ) : null}
          <Link
            href={ledgerHref({ transfers: !includeExcluded, q: query })}
            className="btn-quiet"
          >
            {includeExcluded ? 'Ocultar transferências' : 'Mostrar transferências'}
          </Link>
        </div>
      </header>
      <StaleBanner health={view.health} />

      {/* A plain GET form, not a server action: the search belongs in the URL
          next to the transfers toggle, so it can be shared, bookmarked and
          survives a reload. A POST or client state would give none of that,
          and the browser's own form submit needs no JavaScript. */}
      <form action="/ledger" method="get" role="search" className="ledger__search">
        {includeExcluded ? <input type="hidden" name="transfers" value="1" /> : null}
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Buscar por descrição ou estabelecimento"
          aria-label="Buscar lançamentos"
        />
        <button type="submit">Buscar</button>
        {query ? (
          <Link href={ledgerHref({ transfers: includeExcluded, q: '' })} className="btn-quiet">
            Limpar
          </Link>
        ) : null}
      </form>

      {/* Says out loud what the day totals below are now totals OF. Under a
          search every header sums only its matching rows, and a reader who
          knows the day was busier than this needs to be told why. */}
      {view.search && view.itemCount > 0 ? (
        <p className="ledger__summary">
          {view.itemCount === 1 ? '1 lançamento' : `${view.itemCount} lançamentos`} para “
          {view.search}” · <strong>{brl(view.totalCents)}</strong>
        </p>
      ) : null}

      <TransactionList
        days={view.days}
        categories={categories.map((category) => ({ id: category.id, name: category.name }))}
        emptyMessage={
          view.search ? `Nenhum lançamento encontrado para “${view.search}”.` : undefined
        }
      />
    </main>
  )
}
