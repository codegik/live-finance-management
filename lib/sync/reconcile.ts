import { seedCategories } from '@/lib/db/categories'
import { seedDefaultRules } from '@/lib/db/rules'
import type { Db } from '@/lib/db/client'
import { connections } from '@/lib/db/schema'
import type { PluggyClient } from '@/lib/pluggy/client'
import { recategorize } from './categorize'
import { refreshTransferFlags } from './transfers'
import { syncConnection } from './transactions'

export async function reconcileAll(
  db: Db,
  pluggy: PluggyClient,
  opts: { now?: Date } = {},
): Promise<{
  succeeded: string[]
  failed: string[]
  recategorized: number
  transfersFlagged: number
}> {
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
  let transfersFlagged = 0
  for (const { householdId } of households) {
    try {
      // Seed FIRST, recategorize SECOND, and the order is load-bearing.
      //
      // A household that predates the categorization migration has no
      // category rows at all -- seedCategories only ever ran from household
      // creation, and the migration inserts nothing. With an empty taxonomy
      // recategorize can resolve nothing: every Pluggy category falls
      // through to null and the whole slice is inert. Seeding here is the
      // backfill; it is idempotent (onConflictDoNothing on
      // (household_id, seed_key)), so for every other household it is a
      // no-op.
      //
      // recategorize then has categories to resolve into, and it is also
      // what backfills merchant_normalized on the pre-existing rows the
      // migration left NULL. That matters beyond tidiness: until they are
      // normalized the inbox groups the entire back-catalogue under one
      // "no usable merchant" group, whose only offered action stamps every
      // row MANUAL -- which no sync or backfill ever revisits.
      await seedCategories(db, householdId)
      await seedDefaultRules(db, householdId)
      // The only pass that corrects is_transfer on a row the mapper did not
      // touch -- one whose Pluggy category changed since the last sync, or
      // one 0006 backfilled and the connector has since re-categorized.
      //
      // Order relative to recategorize is NOT load-bearing: the two passes
      // key on independent columns (is_transfer vs category_id), and
      // recategorize produces no inbox count for this one to influence.
      const { flagged } = await refreshTransferFlags(db, householdId)
      transfersFlagged += flagged
      const { changed } = await recategorize(db, { householdId })
      recategorized += changed
    } catch (error) {
      // Same try/catch as before, now covering the seed too: a failure to
      // seed one household must not stop the others being recategorized.
      console.error('recategorize failed', { householdId, error })
    }
  }

  return { succeeded, failed, recategorized, transfersFlagged }
}
