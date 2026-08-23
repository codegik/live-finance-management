/**
 * What a transaction is, for budgeting purposes.
 *
 * SPEND is the default and the fallback. An unrecognised category is NOT an
 * exclusion: a transaction Pluggy could not categorize belongs in the inbox,
 * where it is visible, rather than being silently dropped from every figure.
 *
 * VERIFIED AGAINST REAL DATA: the four transfer strings were read off a live
 * card statement, not taken from documentation. On that connection they cover
 * 113 transactions, including R$177,174.79 of 'Credit card payment' -- the
 * invoices the household has paid, which appear on the card as credits. Left
 * in, they make every total wrong by the value of every invoice ever paid.
 *
 * That verification is CARD-SIDE ONLY. No checking (BANK) account has ever
 * been connected, so nothing here confirms how this household's bank labels
 * the same invoice payment when it *leaves* checking -- which is exactly the
 * arithmetic hazard this slice exists to prevent: an outgoing card payment
 * counted as checking-account spend would inflate a budget by the invoice
 * total. Treat the transfer strings as UNVERIFIED for BANK accounts, and
 * check them against the first real checking sync before trusting them there.
 *
 * The income strings are UNVERIFIED. No checking account is connected yet, so
 * they are taken from Pluggy's published taxonomy rather than observed from
 * real data. They matter for the opposite reason: on a card a CREDIT is an
 * estorno and correctly reduces category spend, but on checking a CREDIT is
 * salary, and left in it would credit thousands of reais against a budget. The
 * SPEND fallback makes this safe -- an unobserved income string shows up as
 * spend in the inbox, visibly, rather than being silently excluded. These
 * strings must be checked against the first real checking sync and corrected
 * before they are trusted.
 *
 * BOTH SETS ARE DUPLICATED IN SQL. drizzle/0006_budgets.sql backfills the
 * transfer rows and drizzle/0009_budget_role.sql backfills the income rows,
 * because the nightly refreshBudgetRoles pass is up to 24 hours away at
 * deploy time and every figure is wrong until it runs. Adding a category here
 * corrects new and re-synced rows only -- rows already in the database need a
 * new migration. tests/budget-role.test.ts asserts the lists and the SQL
 * agree, so a silent divergence fails the suite rather than the household's
 * totals.
 */
export type BudgetRole = 'SPEND' | 'TRANSFER' | 'INCOME'

export const TRANSFER_PLUGGY_CATEGORIES: ReadonlySet<string> = new Set([
  'Credit card payment',
  'Transfers',
  'Tax on financial operations',
  'Credit card fees',
])

export const INCOME_PLUGGY_CATEGORIES: ReadonlySet<string> = new Set([
  'Salary',
  'Retirement',
  'Interest income',
  'Investment redemption',
])

export function classifyRole(pluggyCategory: string | null | undefined): BudgetRole {
  if (!pluggyCategory) return 'SPEND'
  if (TRANSFER_PLUGGY_CATEGORIES.has(pluggyCategory)) return 'TRANSFER'
  if (INCOME_PLUGGY_CATEGORIES.has(pluggyCategory)) return 'INCOME'
  return 'SPEND'
}
