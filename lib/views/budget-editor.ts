import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { listBudgets } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import type { Db } from '@/lib/db/client'
import { budgetMonthSql, budgetPeriodSql } from '@/lib/db/budget-month-sql'
import { accounts, connections, transactions } from '@/lib/db/schema'
import {
  groupBudgetsByCategory,
  medianMonthlySpend,
  monthBounds,
  resolveBudget,
} from '@/lib/domain/budget'
import { saoPauloPeriod } from '@/lib/domain/dates'
import {
  type CategoryGroup,
  GROUP_BUDGET_ROLE,
  toActualCents,
} from '@/lib/domain/seed-categories'

export type BudgetEditorRow = {
  categoryId: string
  categoryName: string
  /** Which block of the month view this row plans for. */
  group: CategoryGroup
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
        budgetRole: transactions.budgetRole,
        month: budgetPeriodSql,
        total: sql<string>`sum(${transactions.amountCents})`,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .where(
        and(
          eq(connections.householdId, householdId),
          // INCOME as well as SPEND: a Receita category read from spend rows
          // alone would offer no suggestion at all, and planning income by
          // hand is the part of the spreadsheet this screen exists to
          // replace.
          inArray(transactions.budgetRole, ['SPEND', 'INCOME']),
          lt(budgetMonthSql, currentMonthStart),
        ),
      )
      .groupBy(
        transactions.categoryId,
        transactions.budgetRole,
        budgetPeriodSql,
      ),
  ])

  // Every month the household has any history in, so a category spent in
  // three months of nine is not budgeted at the average of its active months.
  const allMonths = new Set(history.map((h) => h.month))
  // Keyed on role as well as category, so a Receita row is suggested from
  // income and a spending row from spend -- never from whichever of the two
  // happened to be written last.
  const totalsByCategory = new Map<string, Map<string, number>>()
  for (const row of history) {
    if (!row.categoryId) continue
    const key = `${row.categoryId}:${row.budgetRole}`
    const months = totalsByCategory.get(key) ?? new Map<string, number>()
    months.set(row.month, Number(row.total))
    totalsByCategory.set(key, months)
  }

  const budgetsByCategory = groupBudgetsByCategory(budgetRows)

  const { start } = monthBounds(period)

  const rows = categories.map((category) => {
    const months = totalsByCategory.get(`${category.id}:${GROUP_BUDGET_ROLE[category.group]}`)
    // Sign-flipped for Receita, the same way the month view flips it: a
    // suggestion of -R$ 49.550,00 is not a suggestion.
    const zeroFilled = months
      ? [...allMonths].map((m) => toActualCents(months.get(m) ?? 0, category.group))
      : []

    // The same carry-forward the month and year screens read, from the same
    // function: a second implementation here is how the editor and the month
    // view start disagreeing about which month a budget came from.
    const inherited = resolveBudget(budgetsByCategory.get(category.id) ?? [], period)

    return {
      categoryId: category.id,
      categoryName: category.name,
      group: category.group,
      amountCents: inherited ? inherited.amountCents : null,
      inheritedFrom:
        inherited && inherited.periodMonth !== start ? inherited.periodMonth.slice(0, 7) : null,
      suggestionCents: medianMonthlySpend(zeroFilled),
      monthsOfHistory: zeroFilled.length,
    }
  })

  return { period, rows }
}
