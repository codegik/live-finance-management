import type { Db } from '@/lib/db/client'
import { connections } from '@/lib/db/schema'
import type { PluggyClient } from '@/lib/pluggy/client'
import { recategorize } from './categorize'
import { syncConnection } from './transactions'

export async function reconcileAll(
  db: Db,
  pluggy: PluggyClient,
  opts: { now?: Date } = {},
): Promise<{ succeeded: string[]; failed: string[]; recategorized: number }> {
  const all = await db
    .select({ id: connections.id })
    .from(connections)
    .orderBy(connections.createdAt)

  const succeeded: string[] = []
  const failed: string[] = []

  for (const connection of all) {
    try {
      await syncConnection(db, pluggy, connection.id, { now: opts.now })
      succeeded.push(connection.id)
    } catch (error) {
      console.error('reconcile failed', { connectionId: connection.id, error })
      failed.push(connection.id)
    }
  }

  // Household-wide, after the syncs: this is what lets an improved
  // normalizer or a corrected Pluggy mapping land without a migration or a
  // backfill job. Failures here are logged, not fatal -- the syncs above
  // already succeeded, and yesterday's categories beat no data at all.
  const households = await db
    .selectDistinct({ householdId: connections.householdId })
    .from(connections)

  let recategorized = 0
  for (const { householdId } of households) {
    try {
      const { changed } = await recategorize(db, { householdId })
      recategorized += changed
    } catch (error) {
      console.error('recategorize failed', { householdId, error })
    }
  }

  return { succeeded, failed, recategorized }
}
