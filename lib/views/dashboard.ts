import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { listBudgets } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import type { Db } from '@/lib/db/client'
import { getHouseholdHealth, type HouseholdHealth } from '@/lib/db/health'
import { accounts, connections, transactions } from '@/lib/db/schema'
import {
  daysInPeriod,
  groupBudgetsByCategory,
  monthBounds,
  pace,
  resolveBudget,
} from '@/lib/domain/budget'
import { saoPauloPeriod, saoPauloToday } from '@/lib/domain/dates'

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
  const { start, end } = monthBounds(period)

  const [totals, categories, budgetRows, health] = await Promise.all([
    db
      .select({
        categoryId: transactions.categoryId,
        // count()/sum() arrive as strings from the driver; Number() at the
        // boundary keeps centavos integral in JS.
        spent: sql<string>`sum(${transactions.amountCents})`,
        count: sql<string>`count(*)`,
        // Variable spend is a rate, so it extrapolates. Committed is a known
        // list, so it does not -- see lib/domain/budget.ts.
        variable: sql<string>`coalesce(sum(${transactions.amountCents}) filter (
          where ${transactions.installmentTotal} is null and ${transactions.date} <= ${today}
        ), 0)`,
        committed: sql<string>`coalesce(sum(${transactions.amountCents}) filter (
          where ${transactions.installmentTotal} is not null or ${transactions.date} > ${today}
        ), 0)`,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .where(
        and(
          eq(connections.householdId, householdId),
          // Invoice payments and fees are not spending.
          eq(transactions.isTransfer, false),
          gte(transactions.date, start),
          lte(transactions.date, end),
        ),
      )
      .groupBy(transactions.categoryId),
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
    const variableCents = Number(sums?.variable ?? 0)
    const committedCents = Number(sums?.committed ?? 0)

    return {
      categoryId: category.id,
      categoryName: category.name,
      spentCents: Number(sums?.spent ?? 0),
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
  const uncategorizedSpentCents = Number(uncategorized?.spent ?? 0)
  const uncategorizedCount = Number(uncategorized?.count ?? 0)

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
    totalSpentCents: totals.reduce((sum, t) => sum + Number(t.spent), 0),
    totalBudgetCents: rows.reduce((sum, row) => sum + (row.budgetCents ?? 0), 0),
    uncategorizedSpentCents,
    uncategorizedCount,
    health,
  }
}
