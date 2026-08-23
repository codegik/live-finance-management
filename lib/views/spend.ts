import { and, eq, gte, lte, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { accounts, connections, transactions } from '@/lib/db/schema'
import { monthBounds } from '@/lib/domain/budget'

export type CategorySpend = {
  /** Null for the uncategorized bucket. */
  categoryId: string | null
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
 */
export async function getCategorySpend(
  db: Db,
  householdId: string,
  period: string,
  today: string,
): Promise<CategorySpend[]> {
  const { start, end } = monthBounds(period)

  const rows = await db
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
        // Only spending counts: not invoice payments, not salary.
        eq(transactions.budgetRole, 'SPEND'),
        gte(transactions.date, start),
        lte(transactions.date, end),
      ),
    )
    .groupBy(transactions.categoryId)

  return rows.map((row) => ({
    categoryId: row.categoryId,
    spentCents: Number(row.spent),
    count: Number(row.count),
    variableCents: Number(row.variable),
    committedCents: Number(row.committed),
  }))
}
