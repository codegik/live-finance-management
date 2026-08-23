import { listBudgets } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import type { Db } from '@/lib/db/client'
import { getHouseholdHealth, type HouseholdHealth } from '@/lib/db/health'
import { daysInPeriod, groupBudgetsByCategory, pace, resolveBudget } from '@/lib/domain/budget'
import { saoPauloPeriod, saoPauloToday } from '@/lib/domain/dates'
import { getCategorySpend } from './spend'

export type DashboardRow = {
  categoryId: string
  categoryName: string
  spentCents: number
  variableCents: number
  committedCents: number
  budgetCents: number | null
  paceCents: number
}

export type DashboardView = {
  period: string
  rows: DashboardRow[]
  totalSpentCents: number
  totalBudgetCents: number
  uncategorizedSpentCents: number
  uncategorizedCount: number
  health: HouseholdHealth
}

export async function getDashboardView(
  db: Db,
  householdId: string,
  opts: { now?: Date } = {},
): Promise<DashboardView> {
  const now = opts.now ?? new Date()
  const period = saoPauloPeriod(now)
  const today = saoPauloToday(now)

  const [totals, categories, budgetRows, health] = await Promise.all([
    getCategorySpend(db, householdId, period, today),
    listCategories(db, householdId),
    listBudgets(db, householdId),
    getHouseholdHealth(db, householdId, opts),
  ])

  const byCategory = new Map(totals.map((t) => [t.categoryId, t]))
  const budgetsByCategory = groupBudgetsByCategory(budgetRows)

  const dayOfMonth = Number(today.slice(8, 10))
  const days = daysInPeriod(period)

  const rows: DashboardRow[] = categories.map((category) => {
    const sums = byCategory.get(category.id)
    const variableCents = sums?.variableCents ?? 0
    const committedCents = sums?.committedCents ?? 0

    return {
      categoryId: category.id,
      categoryName: category.name,
      spentCents: sums?.spentCents ?? 0,
      variableCents,
      committedCents,
      budgetCents:
        resolveBudget(budgetsByCategory.get(category.id) ?? [], period)?.amountCents ?? null,
      paceCents: pace({ variableCents, committedCents, dayOfMonth, daysInPeriod: days }),
    }
  })

  // Uncategorized spend is real money, so it counts toward the household
  // total -- it is simply not attributable to a budget yet.
  //
  // The count is scoped to this period on purpose. countUncategorized() is
  // all-time and the ledger badge wants it that way, but rendering an
  // all-time count next to a this-month amount reads as "200 uncategorized,
  // R$ 50,00" -- two different questions in one badge.
  const uncategorized = byCategory.get(null)
  const uncategorizedSpentCents = uncategorized?.spentCents ?? 0
  const uncategorizedCount = uncategorized?.count ?? 0

  return {
    period,
    rows,
    // Summed from the AGGREGATE, never from `rows`. `rows` comes from
    // listCategories, which excludes archived categories -- and archiving a
    // category does not move the transactions that point at it. Totalling the
    // display projection makes that spend vanish from the headline figure
    // while /ledger still shows it, so the two screens disagree about the
    // same month. The category list decides what to draw; it never decides
    // what to count.
    totalSpentCents: totals.reduce((sum, t) => sum + t.spentCents, 0),
    totalBudgetCents: rows.reduce((sum, row) => sum + (row.budgetCents ?? 0), 0),
    uncategorizedSpentCents,
    uncategorizedCount,
    health,
  }
}
