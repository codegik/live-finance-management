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
 * On a phone this same markup becomes the bottom tab bar -- see the
 * max-width block in globals.css. One nav, two shapes, no duplicated links
 * that could drift out of step with each other.
 */
type Item = { href: string; label: string }

const SECTIONS: { title: string; items: Item[] }[] = [
  {
    title: 'Planejamento',
    items: [
      { href: '/dashboard', label: 'Mês' },
      { href: '/year', label: 'Ano' },
      { href: '/budgets', label: 'Planejar' },
      { href: '/forward', label: 'Comprometido' },
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
    <nav className="sidebar" aria-label="Principal">
      <Link href="/dashboard" className="sidebar__brand">
        <span className="sidebar__mark" aria-hidden="true">
          R$
        </span>
        Live Finance
      </Link>

      {SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="sidebar__section">{section.title}</p>
          <ul className="sidebar__list">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="sidebar__link"
                  aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                >
                  <span>{item.label}</span>
                  {/* The inbox is the one screen with work waiting in it, and
                      the count is the only reason anyone opens it. */}
                  {item.href === '/inbox' && uncategorizedCount > 0 ? (
                    <span className="sidebar__count">{uncategorizedCount}</span>
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
