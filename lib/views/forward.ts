import { and, eq, gte, isNotNull, lte, sql } from 'drizzle-orm'
import { listBudgets } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import type { Db } from '@/lib/db/client'
import { accounts, connections, transactions } from '@/lib/db/schema'
import { addMonths, monthBounds, resolveBudget } from '@/lib/domain/budget'
import { saoPauloPeriod } from '@/lib/domain/dates'

export type ForwardRow = {
  categoryId: string
  categoryName: string
  committedCents: number
  budgetCents: number | null
}

export type ForwardMonth = {
  period: string
  rows: ForwardRow[]
  totalCommittedCents: number
}

const DEFAULT_MONTHS = 6

/**
 * The months already committed by instalments.
 *
 * There is no projection here and none is needed: the connector delivers
 * future parcelas as real dated rows, so this is a read. That is why the
 * parent spec's is_projected column, its deterministic group hash and its
 * reconciliation step do not exist.
 *
 * Only rows carrying an instalment count. An ordinary future-dated purchase
 * is not a commitment schedule, and counting it would answer a different
 * question from the one this screen asks.
 */
export async function getForwardView(
  db: Db,
  householdId: string,
  opts: { months?: number; now?: Date } = {},
): Promise<ForwardMonth[]> {
  const now = opts.now ?? new Date()
  const horizon = opts.months ?? DEFAULT_MONTHS
  // Starts next month: the current one is the dashboard's job.
  const periods = Array.from({ length: horizon }, (_, i) =>
    addMonths(saoPauloPeriod(now), i + 1),
  )

  const from = monthBounds(periods[0]).start
  const to = monthBounds(periods[periods.length - 1]).end

  const [committed, categories, budgetRows] = await Promise.all([
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
          isNotNull(transactions.installmentTotal),
          gte(transactions.date, from),
          lte(transactions.date, to),
        ),
      )
      .groupBy(transactions.categoryId, sql`to_char(${transactions.date}, 'YYYY-MM')`),
    listCategories(db, householdId),
    listBudgets(db, householdId),
  ])

  const committedByMonth = new Map<string, Map<string, number>>()
  for (const row of committed) {
    if (!row.categoryId) continue
    const forMonth = committedByMonth.get(row.month) ?? new Map<string, number>()
    forMonth.set(row.categoryId, Number(row.total))
    committedByMonth.set(row.month, forMonth)
  }

  const budgetsByCategory = new Map<string, { periodMonth: string; amountCents: number }[]>()
  for (const row of budgetRows) {
    const list = budgetsByCategory.get(row.categoryId) ?? []
    list.push({ periodMonth: row.periodMonth, amountCents: row.amountCents })
    budgetsByCategory.set(row.categoryId, list)
  }

  return periods.map((period) => {
    const forMonth = committedByMonth.get(period) ?? new Map<string, number>()

    const rows = categories.map((category) => ({
      categoryId: category.id,
      categoryName: category.name,
      committedCents: forMonth.get(category.id) ?? 0,
      budgetCents: resolveBudget(budgetsByCategory.get(category.id) ?? [], period),
    }))

    return {
      period,
      rows,
      totalCommittedCents: rows.reduce((sum, row) => sum + row.committedCents, 0),
    }
  })
}
