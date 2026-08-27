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
    <div className="grid min-h-[100dvh] grid-cols-1 min-[52rem]:grid-cols-[15rem_1fr]">
      <AppNav uncategorizedCount={uncategorizedCount} />
      {/* The tab bar is `fixed` on a phone, so it floats over the page and its
          last row would otherwise be trapped behind it. This pad is the bar's
          own height plus the safe-area inset; above 52rem the nav is a static
          sidebar column and the pad is not needed. */}
      <div className="min-w-0 pb-[calc(4.25rem+env(safe-area-inset-bottom))] min-[52rem]:pb-0">
        {children}
      </div>
    </div>
  )
}
