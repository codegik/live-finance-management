/**
 * Whether a category has crossed a budget threshold, and whether a crossing
 * that was already notified is still true.
 *
 * Both answers come from the same comparison on purpose. The alternative --
 * having the budget editor and the recategorize pass delete alert_state rows
 * when they write -- puts the re-arm rule in every call site that moves
 * money, where forgetting it is silent: the category simply never alerts
 * again that month and nothing fails. Here the rule reads the world instead
 * of being told about it, so an estorno, a raised budget, a recategorization
 * and every case nobody enumerated are handled identically.
 *
 * No I/O, and no division: `spent / budget >= 0.8` would put a float in the
 * money path for the sake of a comparison that multiplies just as well.
 */

export const THRESHOLDS = [80, 100] as const

export type AlertRow = {
  categoryId: string
  categoryName: string
  spentCents: number
  /** Null when the category has no budget for the month. */
  budgetCents: number | null
}

/** A threshold already notified for this category and month. */
export type FiredAlert = { categoryId: string; threshold: number }

export type AlertCrossing = {
  categoryId: string
  categoryName: string
  threshold: number
  spentCents: number
  budgetCents: number
}

export type AlertPlan = { toFire: AlertCrossing[]; toClear: FiredAlert[] }

function key(categoryId: string, threshold: number): string {
  return `${categoryId}:${threshold}`
}

export function evaluateAlerts({
  rows,
  fired,
}: {
  rows: AlertRow[]
  fired: FiredAlert[]
}): AlertPlan {
  const firedKeys = new Set(fired.map((f) => key(f.categoryId, f.threshold)))
  const present = new Set(rows.map((r) => r.categoryId))

  const toFire: AlertCrossing[] = []
  const toClear: FiredAlert[] = []

  for (const row of rows) {
    // A budget of zero is the editor's empty state, not an instruction to
    // alert on the first centavo.
    const budgetCents = row.budgetCents ?? 0

    for (const threshold of THRESHOLDS) {
      const crossed = budgetCents > 0 && row.spentCents * 100 >= budgetCents * threshold
      const alreadyFired = firedKeys.has(key(row.categoryId, threshold))

      if (crossed && !alreadyFired) {
        toFire.push({
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          threshold,
          spentCents: row.spentCents,
          budgetCents,
        })
      } else if (!crossed && alreadyFired) {
        toClear.push({ categoryId: row.categoryId, threshold })
      }
    }
  }

  // A fired row whose category is no longer in the set -- archived, or
  // deleted -- is unreachable by the loop above, so it would survive every
  // future evaluation and the category could never alert again.
  for (const f of fired) {
    if (!present.has(f.categoryId)) toClear.push(f)
  }

  // The message leads with what is worse. Within a threshold, by name, so
  // two syncs listing the same crossings read the same way.
  toFire.sort((a, b) => b.threshold - a.threshold || a.categoryName.localeCompare(b.categoryName))

  return { toFire, toClear }
}
