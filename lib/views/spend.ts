import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { accounts, connections, transactions } from '@/lib/db/schema'
import { budgetMonthSql } from '@/lib/db/budget-month-sql'
import type { BudgetRole } from '@/lib/domain/budget-role'
import { monthBounds } from '@/lib/domain/budget'

export type CategorySpend = {
  /** Null for the uncategorized bucket. */
  categoryId: string | null
  /**
   * Which role these sums came from. Meaningful only when the caller asked
   * for more than one: with the default `['SPEND']` there is exactly one row
   * per category and every caller that predates the month view ignores it.
   */
  budgetRole: BudgetRole
  spentCents: number
  count: number
  variableCents: number
  committedCents: number
}

/**
 * What a household spent in a month, grouped by category.
 *
 * Shared by the dashboard and the alert evaluator on purpose. A second copy
 * of this query would eventually disagree with the first, and an alert that
 * contradicts the screen it sends you to is worse than no alert -- it is the
 * alert that gets disbelieved.
 *
 * `today` splits variable from committed spend and is the caller's, not this
 * function's, so a test can fix the clock. Only the dashboard's pace uses the
 * split; alerts use `spentCents`.
 *
 * `roles` defaults to SPEND alone, which is what a budget is a cap on. The
 * month view passes INCOME as well so the Receita block has something to
 * total -- and because a second query for income would be the drift this
 * function exists to prevent. Rows are grouped by role as well as category so
 * that a category holding both never has the two silently added together:
 * they have opposite signs (lib/domain/money.ts) and would cancel out.
 */
export async function getCategorySpend(
  db: Db,
  householdId: string,
  period: string,
  today: string,
  opts: { roles?: readonly BudgetRole[] } = {},
): Promise<CategorySpend[]> {
  const roles = opts.roles ?? (['SPEND'] as const)
  const { start, end } = monthBounds(period)

  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      budgetRole: transactions.budgetRole,
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
        // Invoice payments and transfers between the household's own accounts
        // are never in scope: they are the same money counted twice. Salary
        // is in scope only when the caller asks for it by name.
        inArray(transactions.budgetRole, [...roles]),
        // The month the household PAYS this, not the month it was bought:
        // a card purchase on 10/08 leaves the account on the September
        // fatura. See lib/domain/billing.ts.
        gte(budgetMonthSql, start),
        lte(budgetMonthSql, end),
      ),
    )
    .groupBy(transactions.categoryId, transactions.budgetRole)

  return rows.map((row) => ({
    categoryId: row.categoryId,
    budgetRole: row.budgetRole,
    spentCents: Number(row.spent),
    count: Number(row.count),
    variableCents: Number(row.variable),
    committedCents: Number(row.committed),
  }))
}
