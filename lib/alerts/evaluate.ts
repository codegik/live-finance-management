import { clearFired, listFiredAlerts, recordFired } from '@/lib/db/alerts'
import { listBudgets } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import type { Db } from '@/lib/db/client'
import { listHouseholdUsers } from '@/lib/db/households'
import { type AlertRow, evaluateAlerts } from '@/lib/domain/alerts'
import { groupBudgetsByCategory, resolveBudget } from '@/lib/domain/budget'
import { saoPauloPeriod, saoPauloToday } from '@/lib/domain/dates'
import { renderAlertEmail } from '@/lib/email/render'
import type { Mailer } from '@/lib/email/resend'
import { getCategorySpend } from '@/lib/views/spend'

/**
 * Evaluate one household's budgets and notify it of anything newly crossed.
 *
 * Rows are composed exactly as getDashboardView composes them -- the same
 * spend query, the same category list, the same carry-forward resolution --
 * so the mail and the screen cannot disagree about what a category is or what
 * it is budgeted at.
 *
 * THROWS if the send fails. That is the point: `fired_at` is written only
 * after a successful delivery, so a rejection leaves the threshold armed and
 * the next sync retries it. The callers in lib/sync/ catch and log, because
 * a mail failure must never fail a sync.
 */
export async function evaluateAndNotify(
  db: Db,
  mailer: Mailer,
  householdId: string,
  opts: { now?: Date } = {},
): Promise<{ fired: number; cleared: number }> {
  const now = opts.now ?? new Date()
  const period = saoPauloPeriod(now)
  const today = saoPauloToday(now)

  const [spend, categories, budgetRows, fired] = await Promise.all([
    getCategorySpend(db, householdId, period, today),
    listCategories(db, householdId),
    listBudgets(db, householdId),
    listFiredAlerts(db, householdId, period),
  ])

  const spentByCategory = new Map(spend.map((s) => [s.categoryId, s.spentCents]))
  const budgetsByCategory = groupBudgetsByCategory(budgetRows)

  const rows: AlertRow[] = categories.map((category) => ({
    categoryId: category.id,
    categoryName: category.name,
    spentCents: spentByCategory.get(category.id) ?? 0,
    budgetCents:
      resolveBudget(budgetsByCategory.get(category.id) ?? [], period)?.amountCents ?? null,
  }))

  const { toFire, toClear } = evaluateAlerts({ rows, fired })

  // Clears are written first and unconditionally. Re-arming is not
  // notification, and it must not be held hostage to an unrelated mail
  // failure below.
  await clearFired(db, householdId, period, toClear)

  if (toFire.length === 0) return { fired: 0, cleared: toClear.length }

  const users = await listHouseholdUsers(db, householdId)
  const to = users.map((user) => user.email)
  if (to.length === 0) return { fired: 0, cleared: toClear.length }

  const { subject, text } = renderAlertEmail(toFire, period)

  // Send, THEN record. The inverse ordering loses an over-budget alert
  // permanently on one transient Resend error; this ordering risks a
  // duplicate mail if the process dies in between, which is the cheaper
  // failure.
  await mailer.send({ to, subject, text })
  await recordFired(db, householdId, period, toFire)

  return { fired: toFire.length, cleared: toClear.length }
}
