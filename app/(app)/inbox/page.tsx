import { InboxGroupList } from '@/components/InboxGroupList'
import { Badge } from '@/components/ui/badge'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { getInboxView } from '@/lib/views/inbox'

export const dynamic = 'force-dynamic'

export default async function InboxPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const view = await getInboxView(getDb(), session.householdId)

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">A categorizar</h1>
          <p className="text-sm text-muted-foreground">
            Categorizar aqui cria uma regra: o mesmo estabelecimento não volta a aparecer.
          </p>
        </div>
        {view.totalCount > 0 ? (
          <Badge variant="warn">{view.totalCount} pendentes</Badge>
        ) : null}
      </header>
      <InboxGroupList groups={view.groups} categories={view.categories} />
    </main>
  )
}
