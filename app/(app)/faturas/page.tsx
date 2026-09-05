import { FaturaList } from '@/components/FaturaList'
import { StaleBanner } from '@/components/StaleBanner'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { getHouseholdHealth } from '@/lib/db/health'
import { getFaturasView } from '@/lib/views/faturas'

export const dynamic = 'force-dynamic'

export default async function FaturasPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const db = getDb()
  const [view, health] = await Promise.all([
    getFaturasView(db, session.householdId),
    getHouseholdHealth(db, session.householdId),
  ])

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Faturas</h1>
        <p className="text-sm text-muted-foreground">
          O valor que o banco diz que você deve em cada cartão. A fatura fechada vem direto do banco
          e bate com o app dele; a do ciclo aberto ainda está{' '}
          <span className="font-medium text-warn">em formação</span> — estimada pelos lançamentos e
          sem encargos, até o banco fechá-la.
        </p>
      </header>

      <StaleBanner health={health} />

      <FaturaList cards={view.cards} currentPeriod={view.currentPeriod} />
    </main>
  )
}
