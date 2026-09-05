import { eq } from 'drizzle-orm'
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

/**
 * The household-wide passes that follow every sync, in their load-bearing
 * order. Extracted so the nightly reconcile and the on-demand single-connection
 * refresh run the exact same sequence -- a second copy is how the manual button
 * and the cron would start filing the same charge in different months.
 *
 * Every ordering note here is a constraint, not a preference: seed before
 * recategorize (an empty taxonomy resolves nothing), recategorize before roles
 * (a role can be forced by the category a row now sits under), installments
 * before budget-months (the billing shift turns on installment_number). See the
 * original inline comments preserved below.
 */
export async function reconcileHousehold(
  db: Db,
  householdId: string,
): Promise<{
  recategorized: number
  rolesCorrected: number
  installmentsCorrected: number
  budgetMonthsCorrected: number
}> {
  await seedCategories(db, householdId)
  await seedDefaultRules(db, householdId)
  const { changed: recategorized } = await recategorize(db, { householdId })
  const { changed: rolesCorrected } = await refreshBudgetRoles(db, householdId)
  const { changed: installmentsCorrected } = await refreshInstallments(db, householdId)
  const { changed: budgetMonthsCorrected } = await refreshBudgetMonths(db, householdId)
  return { recategorized, rolesCorrected, installmentsCorrected, budgetMonthsCorrected }
}

/**
 * Syncs one connection on demand, then runs the household passes and alerts --
 * the button on Conexões. Returns what moved so the action can tell the user
 * whether the refresh actually changed anything.
 *
 * The forced item update (asking Pluggy to re-fetch from the bank) is the
 * caller's job, not this function's: it is best-effort and rate-limited, and a
 * refresh must still re-read and re-file whatever Pluggy already holds even when
 * that trigger is refused.
 */
export async function reconcileConnection(
  db: Db,
  pluggy: PluggyClient,
  connectionId: string,
  deps: { mailer: Mailer; now?: Date },
): Promise<{ synced: boolean; pruned: number }> {
  const [connection] = await db
    .select({ id: connections.id, householdId: connections.householdId })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1)
  if (!connection) return { synced: false, pruned: 0 }

  const { pruned } = await syncConnection(db, pluggy, connection.id, { now: deps.now })

  try {
    await reconcileHousehold(db, connection.householdId)
  } catch (error) {
    console.error('reconcile passes failed', { householdId: connection.householdId, error })
  }

  // Never let a mail outage fail a refresh the user is watching -- same reason
  // as syncByItemId.
  try {
    await evaluateAndNotify(db, deps.mailer, connection.householdId, { now: deps.now })
  } catch (error) {
    console.error('alerts failed', { householdId: connection.householdId, error })
  }

  return { synced: true, pruned }
}

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
      // The whole load-bearing sequence -- seed, recategorize, roles,
      // installments, budget-months -- lives in reconcileHousehold, so the
      // nightly job and the on-demand refresh button can never drift on the
      // order that decides which month a charge lands in.
      const counts = await reconcileHousehold(db, householdId)
      recategorized += counts.recategorized
      rolesCorrected += counts.rolesCorrected
      installmentsCorrected += counts.installmentsCorrected
      budgetMonthsCorrected += counts.budgetMonthsCorrected
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
