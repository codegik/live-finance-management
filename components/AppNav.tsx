'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * The app's only navigation.
 *
 * A client component, unlike the bare list it replaces, and the trade is
 * deliberate: `usePathname` is what marks the current page, and without a
 * current-page mark an eight-item sidebar is a wall of identical links. The
 * cost is a few hundred bytes of JavaScript on a shell that is already
 * rendered on every screen.
 *
 * On a phone this same markup becomes the bottom tab bar -- the mobile-first
 * utilities below are the phone shape, and the `min-[52rem]:` ones rebuild the
 * sticky sidebar column above that width. One nav, two shapes, no duplicated
 * links that could drift out of step with each other.
 */
type Item = { href: string; label: string }

const SECTIONS: { title: string; items: Item[] }[] = [
  {
    title: 'Planejamento',
    items: [
      { href: '/dashboard', label: 'Mês' },
      { href: '/faturas', label: 'Faturas' },
      { href: '/year', label: 'Ano' },
      { href: '/budgets', label: 'Planejar' },
    ],
  },
  {
    title: 'Lançamentos',
    items: [
      { href: '/ledger', label: 'Extrato' },
      { href: '/inbox', label: 'A categorizar' },
    ],
  },
  {
    title: 'Ajustes',
    items: [
      { href: '/settings/connections', label: 'Conexões' },
      { href: '/settings/categories', label: 'Categorias' },
      { href: '/settings/rules', label: 'Regras' },
      { href: '/settings/members', label: 'Membros' },
    ],
  },
]

/**
 * `/settings/categories` must not light up `/settings`, and `/ledger` must not
 * light up on `/ledger-something`. Exact match, or a match up to a path
 * boundary.
 */
function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppNav({ uncategorizedCount }: { uncategorizedCount: number }) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 top-auto z-10 flex flex-row items-stretch gap-[0.55rem] overflow-x-auto overscroll-x-contain border-t border-border bg-surface px-3 pb-[calc(0.3rem+env(safe-area-inset-bottom))] pt-[0.3rem] [scroll-snap-type:x_proximity] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-[52rem]:sticky min-[52rem]:inset-auto min-[52rem]:top-0 min-[52rem]:h-[100dvh] min-[52rem]:flex-col min-[52rem]:gap-5 min-[52rem]:overflow-visible min-[52rem]:border-r min-[52rem]:border-t-0 min-[52rem]:px-3 min-[52rem]:py-[1.1rem]"
    >
      {/* The brand and the section headings are wayfinding for a sidebar; in a
          tab bar they are stolen width, so they only appear from 52rem up. */}
      <Link
        href="/dashboard"
        className="hidden font-[640] tracking-[-0.02em] text-foreground min-[52rem]:flex min-[52rem]:items-center min-[52rem]:gap-[0.55rem] min-[52rem]:px-2"
      >
        <span
          aria-hidden="true"
          className="grid size-[1.65rem] place-items-center rounded-[6px] bg-[linear-gradient(140deg,var(--accent),var(--pos))] text-[0.8rem] font-extrabold text-[#08090b]"
        >
          R$
        </span>
        Live Finance
      </Link>

      {SECTIONS.map((section, i) => (
        <div
          key={section.title}
          className={`flex shrink-0 items-start self-stretch min-[52rem]:block ${
            i > 0 ? 'border-l border-border pl-[0.55rem] min-[52rem]:border-l-0 min-[52rem]:pl-0' : ''
          }`}
        >
          <p className="hidden uppercase tracking-[0.09em] text-text-faint min-[52rem]:block min-[52rem]:px-[0.6rem] min-[52rem]:pb-[0.35rem] min-[52rem]:text-[0.68rem] min-[52rem]:font-[640]">
            {section.title}
          </p>
          <ul className="m-0 grid list-none grid-flow-col gap-[0.15rem] p-0 min-[52rem]:mb-1 min-[52rem]:grid-flow-row min-[52rem]:gap-px">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                  className="flex shrink-0 flex-col justify-start gap-[0.1rem] whitespace-nowrap rounded-[6px] px-[0.55rem] py-[0.4rem] text-[0.72rem] text-text-dim [scroll-snap-align:center] hover:bg-surface-3 hover:text-foreground hover:no-underline aria-[current=page]:bg-accent-dim aria-[current=page]:font-[560] aria-[current=page]:text-foreground min-[52rem]:flex-row min-[52rem]:items-center min-[52rem]:justify-between min-[52rem]:gap-2 min-[52rem]:whitespace-normal min-[52rem]:px-[0.6rem] min-[52rem]:py-[0.42rem] min-[52rem]:text-[0.875rem]"
                >
                  <span>{item.label}</span>
                  {/* The inbox is the one screen with work waiting in it, and
                      the count is the only reason anyone opens it. */}
                  {item.href === '/inbox' && uncategorizedCount > 0 ? (
                    <span className="min-w-[1.35rem] rounded-full bg-warn-dim px-[0.35rem] text-center font-mono text-[0.7rem] font-[640] text-warn">
                      {uncategorizedCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
