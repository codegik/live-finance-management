import { staleReason, type StaleReason } from '@/lib/domain/health'
import type { Db } from './client'
import { listConnections } from './connections'

export type HouseholdHealth = {
  allFresh: boolean
  stale: { connectionId: string; institution: string; reason: StaleReason }[]
}

export async function getHouseholdHealth(
  db: Db,
  householdId: string,
  opts: { now?: Date } = {},
): Promise<HouseholdHealth> {
  const now = opts.now ?? new Date()
  const all = await listConnections(db, householdId)

  const stale = all.flatMap((connection) => {
    const reason = staleReason(connection, now)
    return reason
      ? [{ connectionId: connection.id, institution: connection.institution, reason }]
      : []
  })

  return { allFresh: stale.length === 0, stale }
}
