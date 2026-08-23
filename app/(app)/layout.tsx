import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * The only navigation in the app. Without it /settings/categories and
 * /settings/rules are reachable only by typing a URL, and the rules screen is
 * the one place a CONTAINS rule can be created -- so an unreachable screen
 * would break a guarantee the design leans on.
 *
 * Deliberately not a client component: these are plain links with no active
 * state, and keeping it on the server means no JavaScript ships for it.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <nav className="nav">
        <ul className="nav__list">
          <li>
            <Link href="/dashboard">Dashboard</Link>
          </li>
          <li>
            <Link href="/ledger">Ledger</Link>
          </li>
          <li>
            <Link href="/inbox">Inbox</Link>
          </li>
          <li>
            <Link href="/forward">Forward</Link>
          </li>
          <li>
            <Link href="/budgets">Budgets</Link>
          </li>
          <li>
            <Link href="/settings/categories">Categories</Link>
          </li>
          <li>
            <Link href="/settings/rules">Rules</Link>
          </li>
        </ul>
      </nav>
      {children}
    </>
  )
}
