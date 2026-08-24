import { sql } from 'drizzle-orm'
import { transactions } from './schema'

/**
 * The month a transaction is budgeted in, as SQL.
 *
 * Defined once and imported by every budgeting query, because four copies of a
 * COALESCE are four chances for one screen to disagree with another about
 * which month a purchase belongs to -- the exact disagreement this column was
 * added to remove.
 *
 * The fallback is not defensive padding: `budget_month` is derived by a pass
 * (lib/sync/budget-month.ts), so a freshly synced row has none until that pass
 * runs. Falling back to the row's own month is what the app did before the
 * column existed, so an unprocessed row is merely un-shifted rather than
 * invisible.
 */
export const budgetMonthSql = sql<string>`coalesce(${transactions.budgetMonth}, date_trunc('month', ${transactions.date})::date)`

/** The same value as `YYYY-MM`, for grouping. */
export const budgetPeriodSql = sql<string>`to_char(coalesce(${transactions.budgetMonth}, date_trunc('month', ${transactions.date})::date), 'YYYY-MM')`
