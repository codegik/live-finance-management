import { and, eq, or } from 'drizzle-orm'
import type { FiredAlert } from '@/lib/domain/alerts'
import { monthBounds } from '@/lib/domain/budget'
import type { Executor } from './client'
import { alertStates } from './schema'

/** Which thresholds have already been notified for a household's month. */
export async function listFiredAlerts(
  exec: Executor,
  householdId: string,
  period: string,
): Promise<FiredAlert[]> {
  const { start } = monthBounds(period)

  return exec
    .select({ categoryId: alertStates.categoryId, threshold: alertStates.threshold })
    .from(alertStates)
    .where(and(eq(alertStates.householdId, householdId), eq(alertStates.periodMonth, start)))
}

/**
 * Written only after a send succeeds. onConflictDoNothing because the write
 * can legitimately repeat: a process that dies between sending and recording
 * sends again on the next sync, and erroring there would fail the sync over
 * an alert that was in fact delivered.
 */
export async function recordFired(
  exec: Executor,
  householdId: string,
  period: string,
  entries: FiredAlert[],
): Promise<void> {
  if (entries.length === 0) return
  const { start } = monthBounds(period)

  await exec
    .insert(alertStates)
    .values(
      entries.map((entry) => ({
        householdId,
        categoryId: entry.categoryId,
        periodMonth: start,
        threshold: entry.threshold,
      })),
    )
    .onConflictDoNothing()
}

export async function clearFired(
  exec: Executor,
  householdId: string,
  period: string,
  entries: FiredAlert[],
): Promise<void> {
  // An empty `or()` compiles to no predicate at all, which would delete every
  // row for the household's month rather than none of them.
  if (entries.length === 0) return
  const { start } = monthBounds(period)

  await exec.delete(alertStates).where(
    and(
      eq(alertStates.householdId, householdId),
      eq(alertStates.periodMonth, start),
      or(
        ...entries.map((entry) =>
          and(
            eq(alertStates.categoryId, entry.categoryId),
            eq(alertStates.threshold, entry.threshold),
          ),
        ),
      ),
    ),
  )
}
