import type { Connection } from '@/lib/db/schema'

export const STALE_AFTER_HOURS = 36

export type StaleReason = 'NEEDS_REAUTH' | 'NOT_UPDATING'

export function staleReason(
  connection: Pick<Connection, 'status' | 'lastSyncedAt'>,
  now: Date,
): StaleReason | null {
  if (connection.status === 'LOGIN_ERROR' || connection.status === 'WAITING_USER_INPUT') {
    return 'NEEDS_REAUTH'
  }

  if (!connection.lastSyncedAt) return 'NOT_UPDATING'

  const ageHours = (now.getTime() - connection.lastSyncedAt.getTime()) / 3_600_000
  if (ageHours > STALE_AFTER_HOURS || connection.status === 'OUTDATED') return 'NOT_UPDATING'

  return null
}
