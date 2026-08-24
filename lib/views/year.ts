import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { listBudgets } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import type { Db } from '@/lib/db/client'
import { budgetMonthSql, budgetPeriodSql } from '@/lib/db/budget-month-sql'
import { accounts, connections, transactions } from '@/lib/db/schema'
import { groupBudgetsByCategory, monthBounds, resolveBudget } from '@/lib/domain/budget'
import { saoPauloPeriod } from '@/lib/domain/dates'
import {
  CATEGORY_GROUP_LABELS,
  CATEGORY_GROUPS,
  type CategoryGroup,
  GROUP_BUDGET_ROLE,
  toActualCents,
} from '@/lib/domain/seed-categories'

export type YearCell = {
  period: string
  actualCents: number
  plannedCents: number | null
}

export type YearRow = {
  categoryId: string
  categoryName: string
  group: CategoryGroup
  /** One cell per period, in the same order as `YearView.periods`. */
  cells: YearCell[]
  totalActualCents: number
  totalPlannedCents: number
}

export type YearGroupView = {
  group: CategoryGroup
  label: string
  rows: YearRow[]
  actualByMonth: number[]
  plannedByMonth: number[]
  totalActualCents: number
}

export type YearView = {
  year: number
  periods: string[]
  /** Index of the household's current month in `periods`, or -1 if not in this year. */
  currentIndex: number
  groups: YearGroupView[]
  incomeByMonth: number[]
  investedByMonth: number[]
  expenseByMonth: number[]
  netByMonth: number[]
  /** Spend no drawn row accounts for: uncategorized rows and archived categories. */
  unallocatedByMonth: number[]
}

/**
 * Twelve months of the household's sheet at once: categories down, months
 * across, the shape the household already reads.
 *
 * One query for the year rather than twelve calls to getMonthView. The month
 * view resolves a pace, a health check and an uncategorized count that a grid
 * cell has nowhere to show, and paying for them twelve times over would make
 * this the slowest screen in the app to render numbers nobody reads here. The
 * two arithmetic rules the screens MUST share -- carry-forward and the income
 * sign flip -- are imported, not restated: resolveBudget and actualSign.
 */
export async function getYearView(
  db: Db,
  householdId: string,
  year: number,
  opts: { now?: Date } = {},
): Promise<YearView> {
  const periods = Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`,
  )
  const from = monthBounds(periods[0]).start
  const to = monthBounds(periods[11]).end

  const [totals, categories, budgetRows] = await Promise.all([
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
          // TRANSFER is absent for the reason it is absent everywhere: an
          // invoice paid from checking is the card spend it settles, counted
          // a second time.
          inArray(transactions.budgetRole, ['SPEND', 'INCOME']),
          gte(budgetMonthSql, from),
          lte(budgetMonthSql, to),
        ),
      )
      .groupBy(
        transactions.categoryId,
        transactions.budgetRole,
        budgetPeriodSql,
      ),
    listCategories(db, householdId),
    listBudgets(db, householdId),
  ])

  const byKey = new Map<string, number>()
  // The accounting figures, per month, straight off the aggregate -- they
  // include archived categories and uncategorized rows, which no cell draws.
  const spentByMonth = new Map<string, number>()
  const incomeByMonthMap = new Map<string, number>()
  for (const row of totals) {
    const amount = Number(row.total)
    byKey.set(`${row.categoryId}:${row.budgetRole}:${row.month}`, amount)
    const target = row.budgetRole === 'INCOME' ? incomeByMonthMap : spentByMonth
    target.set(row.month, (target.get(row.month) ?? 0) + amount)
  }

  const budgetsByCategory = groupBudgetsByCategory(budgetRows)

  const rows: YearRow[] = categories.map((category) => {
    const role = GROUP_BUDGET_ROLE[category.group]
    const budgets = budgetsByCategory.get(category.id) ?? []

    const cells = periods.map((period) => ({
      period,
      actualCents: toActualCents(
        byKey.get(`${category.id}:${role}:${period}`) ?? 0,
        category.group,
      ),
      // Carry-forward resolved per month from the full history, exactly as the
      // month view does it: a budget set in August is what answers October.
      plannedCents: resolveBudget(budgets, period)?.amountCents ?? null,
    }))

    return {
      categoryId: category.id,
      categoryName: category.name,
      group: category.group,
      cells,
      totalActualCents: cells.reduce((sum, cell) => sum + cell.actualCents, 0),
      totalPlannedCents: cells.reduce((sum, cell) => sum + (cell.plannedCents ?? 0), 0),
    }
  })

  const groups: YearGroupView[] = CATEGORY_GROUPS.map((group) => {
    const groupRows = rows.filter((row) => row.group === group)
    return {
      group,
      label: CATEGORY_GROUP_LABELS[group],
      rows: groupRows,
      actualByMonth: periods.map((_, i) =>
        groupRows.reduce((sum, row) => sum + row.cells[i].actualCents, 0),
      ),
      plannedByMonth: periods.map((_, i) =>
        groupRows.reduce((sum, row) => sum + (row.cells[i].plannedCents ?? 0), 0),
      ),
      totalActualCents: groupRows.reduce((sum, row) => sum + row.totalActualCents, 0),
    }
  })

  const byGroup = new Map(groups.map((g) => [g.group, g]))
  const monthly = (group: CategoryGroup) =>
    byGroup.get(group)?.actualByMonth ?? periods.map(() => 0)

  const investedByMonth = monthly('INVESTIMENTO')
  const incomeByMonth = periods.map((period) =>
    toActualCents(incomeByMonthMap.get(period) ?? 0, 'RECEITA'),
  )
  const expenseByMonth = periods.map(
    (period, i) => (spentByMonth.get(period) ?? 0) - investedByMonth[i],
  )
  const drawnSpendByMonth = periods.map(
    (_, i) =>
      investedByMonth[i] +
      monthly('DESPESA_FIXA')[i] +
      monthly('DESPESA_VARIAVEL')[i],
  )

  return {
    year,
    periods,
    currentIndex: periods.indexOf(saoPauloPeriod(opts.now ?? new Date())),
    groups,
    incomeByMonth,
    investedByMonth,
    expenseByMonth,
    netByMonth: periods.map((_, i) => incomeByMonth[i] - investedByMonth[i] - expenseByMonth[i]),
    unallocatedByMonth: periods.map(
      (period, i) => (spentByMonth.get(period) ?? 0) - drawnSpendByMonth[i],
    ),
  }
}
