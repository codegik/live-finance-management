import { Search } from 'lucide-react'
import Link from 'next/link'
import { StaleBanner } from '@/components/StaleBanner'
import { TransactionList } from '@/components/TransactionList'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { listCategories } from '@/lib/db/categories'
import { getDb } from '@/lib/db/client'
import { brl } from '@/lib/format'
import { getLedgerView } from '@/lib/views/ledger'

export const dynamic = 'force-dynamic'

/**
 * This screen's whole state lives in the URL: `?transfers=1`, `?q=` and
 * `?page=`. Every link and form here has to carry the OTHERS through, or using
 * one control silently resets them -- searching would drop you back to
 * spend-only, and toggling transfers would throw away what you typed.
 *
 * page is the exception the controls WANT: it is omitted unless asked for, so
 * the search form and the transfers toggle (which do not pass it) reset to
 * page 1, which is what you want the moment the result set changes underneath
 * you. Only the pager itself passes a page.
 */
function ledgerHref(params: { transfers: boolean; q: string; page?: number }): string {
  const search = new URLSearchParams()
  if (params.transfers) search.set('transfers', '1')
  if (params.q) search.set('q', params.q)
  if (params.page && params.page > 1) search.set('page', String(params.page))
  const query = search.toString()
  return query ? `/ledger?${query}` : '/ledger'
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ transfers?: string; q?: string; page?: string }>
}) {
  // requireSession() throws on no session -- correct for API routes, but a
  // server component that lets that escape renders Next's generic 500 page.
  // "You're not signed in" isn't a server error; send the user to /signin
  // instead. Any other failure still propagates and surfaces as a 500.
  const session = await requireSession().catch(toSignInOrThrow)
  const { transfers, q, page } = await searchParams
  const includeExcluded = transfers === '1'
  const query = q?.trim() ?? ''
  // parseInt tolerates the junk a URL can carry ('?page=abc' -> NaN); the view
  // treats NaN and anything below 1 as page 1 and clamps the top end, so the
  // page never has to guard the range itself.
  const requestedPage = Number.parseInt(page ?? '', 10)

  const db = getDb()
  const [view, categories] = await Promise.all([
    getLedgerView(db, session.householdId, {
      includeExcluded,
      search: query,
      page: requestedPage,
    }),
    // For the inline category picker on each row. Live categories only: an
    // archived one is a legitimate place for old spend to sit, but never a
    // place to move spend to.
    listCategories(db, session.householdId),
  ])

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Extrato</h1>
          <p className="text-sm text-muted-foreground">
            {includeExcluded
              ? 'Incluindo transferências e receitas'
              : 'Apenas gastos — transferências e receitas ocultas'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {view.uncategorizedCount > 0 ? (
            <Link href="/inbox">
              <Badge variant="warn">{view.uncategorizedCount} a categorizar</Badge>
            </Link>
          ) : null}
          <Link
            href={ledgerHref({ transfers: !includeExcluded, q: query })}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
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
      <form action="/ledger" method="get" role="search" className="flex items-center gap-2">
        {includeExcluded ? <input type="hidden" name="transfers" value="1" /> : null}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Buscar por descrição ou estabelecimento"
            aria-label="Buscar lançamentos"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
        {query ? (
          <Link
            href={ledgerHref({ transfers: includeExcluded, q: '' })}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            Limpar
          </Link>
        ) : null}
      </form>

      {/* Says out loud what the day totals below are now totals OF. Under a
          search every header sums only its matching rows, and a reader who
          knows the day was busier than this needs to be told why. */}
      {view.search && view.matchCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {view.matchCount === 1 ? '1 lançamento' : `${view.matchCount} lançamentos`} para “
          {view.search}” ·{' '}
          <strong className="font-mono tabular-nums text-foreground">
            {brl(view.matchTotalCents)}
          </strong>
        </p>
      ) : null}

      <TransactionList
        days={view.days}
        categories={categories.map((category) => ({ id: category.id, name: category.name }))}
        emptyMessage={
          view.search ? `Nenhum lançamento encontrado para “${view.search}”.` : undefined
        }
      />

      {/* Only worth drawing once there is more than one page. A single-page
          ledger gets no footer at all, exactly as before pagination existed. */}
      {view.pagination.pageCount > 1 ? (
        <nav
          aria-label="Paginação"
          className="flex items-center justify-between gap-4 border-t border-border pt-4"
        >
          {view.pagination.hasPrev ? (
            <Link
              href={ledgerHref({
                transfers: includeExcluded,
                q: query,
                page: view.pagination.page - 1,
              })}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              rel="prev"
            >
              Anterior
            </Link>
          ) : (
            // A disabled span, not an absent one, so "Próxima" keeps its side of
            // the row and does not jump left on the first page.
            <span
              className={`${buttonVariants({ variant: 'outline', size: 'sm' })} pointer-events-none opacity-40`}
              aria-disabled
            >
              Anterior
            </span>
          )}
          <span className="text-sm tabular-nums text-muted-foreground">
            Página {view.pagination.page} de {view.pagination.pageCount}
          </span>
          {view.pagination.hasNext ? (
            <Link
              href={ledgerHref({
                transfers: includeExcluded,
                q: query,
                page: view.pagination.page + 1,
              })}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              rel="next"
            >
              Próxima
            </Link>
          ) : (
            <span
              className={`${buttonVariants({ variant: 'outline', size: 'sm' })} pointer-events-none opacity-40`}
              aria-disabled
            >
              Próxima
            </span>
          )}
        </nav>
      ) : null}
    </main>
  )
}
