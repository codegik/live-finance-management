import { ConnectBankButton } from '@/components/ConnectBankButton'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { listConnectionDetails } from '@/lib/db/connections'
import { HOUSEHOLD_TIME_ZONE } from '@/lib/domain/dates'

export const dynamic = 'force-dynamic'

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

export default async function ConnectionsSettingsPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const details = await listConnectionDetails(getDb(), session.householdId)

  return (
    <main className="page page--narrow">
      <header className="page__header">
        <h1>Connections</h1>
        <ConnectBankButton />
      </header>

      {details.length === 0 ? (
        <p className="empty">No banks connected yet.</p>
      ) : (
        <ul className="settings__list">
          {details.map((connection) => (
            <li key={connection.id} className="settings__row settings__row--stacked">
              <div>
                <strong>{connection.institution}</strong> · {connection.ownerName}
                <p className="settings__meta">
                  {connection.status.toLowerCase().replaceAll('_', ' ')} ·{' '}
                  {syncedLabel(connection.lastSyncedAt)}
                </p>
                {connection.stale ? (
                  <p role="alert" className="form__error">
                    {connection.stale === 'NEEDS_REAUTH'
                      ? 'This bank needs reconnecting before its figures can be trusted.'
                      : 'This bank has not updated recently.'}
                  </p>
                ) : null}
                <ul className="settings__sublist">
                  {connection.accounts.map((account) => (
                    <li key={account.id}>
                      {account.name} {account.last4 ? `••${account.last4}` : null} ·{' '}
                      {account.type === 'CREDIT' ? 'card' : 'checking'}
                      {account.dueDay ? ` · due on the ${account.dueDay}` : null}
                    </li>
                  ))}
                </ul>
              </div>
              <ConnectBankButton itemId={connection.pluggyItemId} label="Reconnect" />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
