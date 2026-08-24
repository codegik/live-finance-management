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
        <div className="page__title">
          <h1>A categorizar</h1>
          <span className="page__sub">
            Categorizar aqui cria uma regra: o mesmo estabelecimento não volta a aparecer.
          </span>
        </div>
        {view.totalCount > 0 ? (
          <span className="badge">{view.totalCount} pendentes</span>
        ) : null}
      </header>
      <InboxGroupList groups={view.groups} categories={view.categories} />
    </main>
  )
}
