import type { ReactNode } from 'react'
import { AppNav } from '@/components/AppNav'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { countUncategorized } from '@/lib/views/inbox'

export const dynamic = 'force-dynamic'

/**
 * The shell every signed-in screen is drawn inside: a sidebar on a desktop, a
 * tab bar on a phone.
 *
 * The session is read here rather than passed down because the nav's inbox
 * count needs a household. It deliberately does NOT redirect on a missing
 * session: every page below already calls requireSession().catch(toSignInOrThrow),
 * and a second redirect here would race the first. A layout that cannot name
 * the household simply draws the nav with nothing waiting in it.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const uncategorizedCount = await requireSession()
    .then((session) => countUncategorized(getDb(), session.householdId))
    .catch(() => 0)

  return (
    <div className="shell">
      <AppNav uncategorizedCount={uncategorizedCount} />
      <div className="content">{children}</div>
    </div>
  )
}
