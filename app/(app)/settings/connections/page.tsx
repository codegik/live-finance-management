import { CreditCard, Landmark, Trash2, Wallet } from 'lucide-react'
import Link from 'next/link'
import { ConnectBankButton } from '@/components/ConnectBankButton'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import {
  type ConnectionDetail,
  countConnectionTransactions,
  listConnectionDetails,
} from '@/lib/db/connections'
import { HOUSEHOLD_TIME_ZONE } from '@/lib/domain/dates'
import { AccountDaysForm, RefreshConnectionForm, RemoveConnectionForm } from './ConnectionForms'
import { idSchema } from './state'

export const dynamic = 'force-dynamic'

/** A coloured dot + label for the connection's sync health. The colours are
 *  the app's meaning-carrying ones: green = current, amber = going stale,
 *  red = broken and needs the household to act. */
function StatusPill({ status }: { status: ConnectionDetail['status'] }) {
  const tone: Record<ConnectionDetail['status'], { dot: string; text: string }> = {
    UPDATED: { dot: 'bg-pos', text: 'text-pos' },
    UPDATING: { dot: 'bg-accent-blue', text: 'text-muted-foreground' },
    OUTDATED: { dot: 'bg-warn', text: 'text-warn' },
    LOGIN_ERROR: { dot: 'bg-neg', text: 'text-neg' },
    WAITING_USER_INPUT: { dot: 'bg-neg', text: 'text-neg' },
  }
  const t = tone[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${t.text}`}
    >
      <span className={`size-1.5 rounded-full ${t.dot}`} />
      {status.toLowerCase().replaceAll('_', ' ')}
    </span>
  )
}

// Formatted in the household's zone, not UTC -- this line exists to tell the
// user how current their data is, and a UTC clock would be quietly wrong by
// three hours for the one household this app serves.
function syncedLabel(at: Date | null): string {
  if (!at) return 'never synced'
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: HOUSEHOLD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(at)
    .replace(', ', ' ')
  return `synced ${formatted}`
}

export default async function ConnectionsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ remove?: string }>
}) {
  const session = await requireSession().catch(toSignInOrThrow)
  const { remove } = await searchParams
  const db = getDb()
  const details = await listConnectionDetails(db, session.householdId)
  // A hand-edited ?remove= that is not a UUID would otherwise reach
  // eq(connections.id, ...) inside countConnectionTransactions and 500 the
  // page with Postgres 22P02. Treat it the same as an id that simply does
  // not match any connection: no confirmation renders.
  const removeId = remove && idSchema.safeParse(remove).success ? remove : null
  const removing = removeId
    ? { id: removeId, count: await countConnectionTransactions(db, session.householdId, removeId) }
    : null

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6 sm:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
          <p className="text-sm text-muted-foreground">
            Banks and cards linked to your household, and how fresh their data is.
          </p>
        </div>
        <ConnectBankButton />
      </header>

      {details.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong p-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
            <Landmark className="size-6" />
          </div>
          <p className="text-sm text-muted-foreground">No banks connected yet.</p>
          <ConnectBankButton />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {details.map((connection) => (
            <Card
              key={connection.id}
              className="overflow-hidden rounded-xl transition-colors hover:border-border-strong"
            >
              <CardHeader className="gap-4 border-b border-border bg-surface-2/40">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-blue/25 to-pos/20 text-foreground">
                      <Landmark className="size-5" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold leading-none">
                          {connection.institution}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          · {connection.ownerName}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill status={connection.status} />
                        <span className="text-xs text-text-faint">
                          · {syncedLabel(connection.lastSyncedAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <RefreshConnectionForm connectionId={connection.id} />
                    <ConnectBankButton
                      itemId={connection.pluggyItemId}
                      label="Reconnect"
                      variant="outline"
                      size="sm"
                    />
                  </div>
                </div>
                {connection.stale ? (
                  <p
                    role="alert"
                    className="rounded-md border border-neg/40 bg-neg-dim/60 px-3 py-2 text-sm text-neg"
                  >
                    {connection.stale === 'NEEDS_REAUTH'
                      ? 'This bank needs reconnecting before its figures can be trusted.'
                      : 'This bank has not updated recently.'}
                  </p>
                ) : null}
              </CardHeader>

              <CardContent className="flex flex-col gap-3 pt-5">
                <ul className="flex flex-col gap-3">
                  {connection.accounts.map((account) => (
                    <li
                      key={account.id}
                      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3.5"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-muted-foreground">
                          {account.type === 'CREDIT' ? (
                            <CreditCard className="size-4" />
                          ) : (
                            <Wallet className="size-4" />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium">{account.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {account.last4 ? (
                              <span className="font-mono">••{account.last4}</span>
                            ) : null}
                            {account.last4 ? ' · ' : null}
                            {account.type === 'CREDIT' ? 'credit card' : 'checking'}
                          </span>
                        </div>
                        <Badge
                          variant={account.type === 'CREDIT' ? 'secondary' : 'outline'}
                          className="ml-auto"
                        >
                          {account.type === 'CREDIT' ? 'card' : 'checking'}
                        </Badge>
                      </div>
                      {account.type === 'CREDIT' ? (
                        <AccountDaysForm
                          accountId={account.id}
                          dueDayOverride={account.dueDayOverride}
                          closingDayOverride={account.closingDayOverride}
                          pluggyDueDay={account.pluggyDueDay}
                          pluggyClosingDay={account.pluggyClosingDay}
                          dueDayOverridden={account.dueDayOverridden}
                          closingDayOverridden={account.closingDayOverridden}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>

                {removing?.id === connection.id ? (
                  <RemoveConnectionForm
                    connectionId={connection.id}
                    institution={connection.institution}
                    transactionCount={removing.count}
                  />
                ) : (
                  <Link
                    href={`/settings/connections?remove=${connection.id}`}
                    className={buttonVariants({
                      variant: 'ghost',
                      size: 'sm',
                      className: 'mt-1 self-start text-neg hover:bg-neg-dim/40 hover:text-neg',
                    })}
                  >
                    <Trash2 className="size-4" />
                    Remove
                  </Link>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  )
}
