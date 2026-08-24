import { evaluateAndNotify } from '@/lib/alerts/evaluate'
import { seedCategories } from '@/lib/db/categories'
import { seedDefaultRules } from '@/lib/db/rules'
import type { Db } from '@/lib/db/client'
import { connections } from '@/lib/db/schema'
import type { Mailer } from '@/lib/email/resend'
import type { PluggyClient } from '@/lib/pluggy/client'
import { recategorize } from './categorize'
import { refreshBudgetRoles } from './budget-roles'
import { refreshBudgetMonths } from './budget-month'
import { refreshInstallments } from './installments'
import { syncConnection } from './transactions'

export async function reconcileAll(
  db: Db,
  pluggy: PluggyClient,
  deps: { mailer: Mailer; now?: Date },
): Promise<{
  succeeded: string[]
  failed: string[]
  recategorized: number
  rolesCorrected: number
  installmentsCorrected: number
  budgetMonthsCorrected: number
  alerted: number
}> {
  const all = await db
    .select({ id: connections.id })
    .from(connections)
    .orderBy(connections.createdAt)

  const succeeded: string[] = []
  const failed: string[] = []

  for (const connection of all) {
    try {
      await syncConnection(db, pluggy, connection.id, { now: deps.now })
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
  let rolesCorrected = 0
  let installmentsCorrected = 0
  let budgetMonthsCorrected = 0
  let alerted = 0
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
      // The only pass that corrects budget_role on a row the mapper did not
      // touch -- one whose Pluggy category changed since the last sync, or
      // one 0009 backfilled and the connector has since re-categorized.
      //
      // Order relative to recategorize is NOT load-bearing: the two passes
      // key on independent columns (budget_role vs category_id), and
      // recategorize produces no inbox count for this one to influence.
      const { changed: roled } = await refreshBudgetRoles(db, householdId)
      rolesCorrected += roled
      // Same reasoning, and the same independence: this pass keys on
      // installment_number/total, which nothing else writes. It is here
      // rather than only at ingest because drizzle/0006 added those columns
      // with no backfill and Pluggy never re-delivers an old transaction --
      // so every row that predates the columns is NULL until something goes
      // back and reads its descriptor. See lib/sync/installments.ts.
      const { changed: parcels } = await refreshInstallments(db, householdId)
      installmentsCorrected += parcels
      // AFTER refreshInstallments, and the order is load-bearing: the billing
      // rule turns on installment_number, because instalments 2..N arrive
      // already dated by the fatura they belong to. Run first, every parcela
      // would be shifted a second time and land a month late.
      const { changed: months } = await refreshBudgetMonths(db, householdId)
      budgetMonthsCorrected += months
      const { changed } = await recategorize(db, { householdId })
      recategorized += changed
    } catch (error) {
      // Same try/catch as before, now covering the seed too: a failure to
      // seed one household must not stop the others being recategorized.
      console.error('recategorize failed', { householdId, error })
    }

    // AFTER recategorize, and the order is load-bearing here in a way the
    // pair above is not: recategorize moves spend between categories, so
    // evaluating first would mail about a category the very next pass
    // corrects.
    //
    // Its own try/catch rather than the outer one, so a mail failure is
    // not logged as 'recategorize failed' and does not discard the counts
    // the passes above just produced.
    try {
      const { fired } = await evaluateAndNotify(db, deps.mailer, householdId, { now: deps.now })
      alerted += fired
    } catch (error) {
      console.error('alerts failed', { householdId, error })
    }
  }

  return {
    succeeded,
    failed,
    recategorized,
    rolesCorrected,
    installmentsCorrected,
    budgetMonthsCorrected,
    alerted,
  }
}
