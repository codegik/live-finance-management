import { InboxGroupList } from '@/components/InboxGroupList'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { getInboxView } from '@/lib/views/inbox'

export const dynamic = 'force-dynamic'

export default async function InboxPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const view = await getInboxView(getDb(), session.householdId)

  return (
    <main className="page">
      <header className="page__header">
        <h1>Inbox</h1>
        <span>{view.totalCount} uncategorized</span>
      </header>
      <InboxGroupList groups={view.groups} categories={view.categories} />
    </main>
  )
}
