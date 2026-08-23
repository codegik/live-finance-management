import { and, eq, lt, sql } from 'drizzle-orm'
import { listBudgets } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import type { Db } from '@/lib/db/client'
import { accounts, connections, transactions } from '@/lib/db/schema'
import { medianMonthlySpend, monthBounds } from '@/lib/domain/budget'
import { saoPauloPeriod } from '@/lib/domain/dates'

export type BudgetEditorRow = {
  categoryId: string
  categoryName: string
  /** The amount in force for this period, inherited or explicit. */
  amountCents: number | null
  /** The period an inherited amount came from, or null if it is this month's own. */
  inheritedFrom: string | null
  suggestionCents: number | null
  monthsOfHistory: number
}

export type BudgetEditorView = { period: string; rows: BudgetEditorRow[] }

export async function getBudgetEditorView(
  db: Db,
  householdId: string,
  period: string,
  opts: { now?: Date } = {},
): Promise<BudgetEditorView> {
  const now = opts.now ?? new Date()
  // Complete months only: the current month is partial, and later months hold
  // nothing but instalments. Both would drag the median toward a figure the
  // household never actually spent in a month.
  const { start: currentMonthStart } = monthBounds(saoPauloPeriod(now))

  const [categories, budgetRows, history] = await Promise.all([
    listCategories(db, householdId),
    listBudgets(db, householdId),
    db
      .select({
        categoryId: transactions.categoryId,
        month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`,
        total: sql<string>`sum(${transactions.amountCents})`,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .where(
        and(
          eq(connections.householdId, householdId),
          eq(transactions.isTransfer, false),
          lt(transactions.date, currentMonthStart),
        ),
      )
      .groupBy(transactions.categoryId, sql`to_char(${transactions.date}, 'YYYY-MM')`),
  ])

  // Every month the household has any history in, so a category spent in
  // three months of nine is not budgeted at the average of its active months.
  const allMonths = new Set(history.map((h) => h.month))
  const totalsByCategory = new Map<string, Map<string, number>>()
  for (const row of history) {
    if (!row.categoryId) continue
    const months = totalsByCategory.get(row.categoryId) ?? new Map<string, number>()
    months.set(row.month, Number(row.total))
    totalsByCategory.set(row.categoryId, months)
  }

  const budgetsByCategory = new Map<string, { periodMonth: string; amountCents: number }[]>()
  for (const row of budgetRows) {
    const list = budgetsByCategory.get(row.categoryId) ?? []
    list.push({ periodMonth: row.periodMonth, amountCents: row.amountCents })
    budgetsByCategory.set(row.categoryId, list)
  }

  const { start } = monthBounds(period)

  const rows = categories.map((category) => {
    const months = totalsByCategory.get(category.id)
    const zeroFilled = months ? [...allMonths].map((m) => months.get(m) ?? 0) : []

    const own = budgetsByCategory.get(category.id) ?? []
    let inherited: { periodMonth: string; amountCents: number } | null = null
    for (const row of own) {
      if (row.periodMonth > start) continue
      if (!inherited || row.periodMonth > inherited.periodMonth) inherited = row
    }

    return {
      categoryId: category.id,
      categoryName: category.name,
      amountCents: inherited ? inherited.amountCents : null,
      inheritedFrom:
        inherited && inherited.periodMonth !== start ? inherited.periodMonth.slice(0, 7) : null,
      suggestionCents: medianMonthlySpend(zeroFilled),
      monthsOfHistory: zeroFilled.length,
    }
  })

  return { period, rows }
}
