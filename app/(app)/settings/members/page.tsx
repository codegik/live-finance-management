import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/db/client'
import { listMembers } from '@/lib/db/households'
import { listPendingInvites } from '@/lib/db/invites'
import { InviteForm, RevokeInviteButton } from './MembersForms'

export const dynamic = 'force-dynamic'

export default async function MembersSettingsPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const db = getDb()
  const [members, pending] = await Promise.all([
    listMembers(db, session.householdId),
    listPendingInvites(db, session.householdId),
  ])

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Membros</h1>
        <p className="text-sm text-muted-foreground">
          Todos que entram compartilham as mesmas contas, categorias e lançamentos da casa. Convide
          alguém e envie o link — quem abrir escolhe a própria senha.
        </p>
      </header>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>Convidar</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteForm />
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader className="flex-row items-center justify-between gap-2 border-b border-border bg-surface-2/40">
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
            Na casa
          </CardTitle>
          <Badge variant="secondary">{members.length}</Badge>
        </CardHeader>
        <CardContent className="pt-4">
          <ul className="flex flex-col divide-y divide-border">
            {members.map((member, i) => (
              <li key={member.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {member.name}
                    {member.id === session.id ? (
                      <span className="text-muted-foreground"> (você)</span>
                    ) : null}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">{member.email}</span>
                </div>
                {/* The oldest member is the one who set the house up. It carries
                    no privilege today -- everyone can invite -- it is only a
                    label so the household can tell who started it. */}
                {i === 0 ? <Badge variant="secondary">Dono</Badge> : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {pending.length > 0 ? (
        <Card className="rounded-xl">
          <CardHeader className="flex-row items-center justify-between gap-2 border-b border-border bg-surface-2/40">
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              Convites pendentes
            </CardTitle>
            <Badge variant="secondary">{pending.length}</Badge>
          </CardHeader>
          <CardContent className="pt-4">
            <ul className="flex flex-col divide-y divide-border">
              {pending.map((invite) => (
                <li key={invite.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{invite.name}</span>
                    <span className="truncate text-sm text-muted-foreground">{invite.email}</span>
                  </div>
                  <RevokeInviteButton inviteId={invite.id} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </main>
  )
}
