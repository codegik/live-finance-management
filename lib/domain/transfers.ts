/**
 * Money that moves without being spent.
 *
 * VERIFIED AGAINST REAL DATA: these four strings were read off a live card
 * statement, not taken from documentation. On that connection they cover 113
 * transactions, including R$177,174.79 of 'Credit card payment' -- the
 * invoices the household has paid, which appear on the card as credits. Left
 * in, they make every total wrong by the value of every invoice ever paid.
 *
 * An unrecognised category is NOT a transfer. A transaction Pluggy could not
 * categorize belongs in the inbox, where it is visible, rather than being
 * silently dropped from every figure.
 *
 * When checking accounts arrive in Slice 6 this needs a second detector --
 * matching an invoice payment leaving checking against the card it settles --
 * and this is the module it goes in.
 *
 * THIS SET IS DUPLICATED IN SQL. drizzle/0006_budgets.sql backfills
 * is_transfer on the rows that predate the column, using these same four
 * strings, because the nightly refreshTransferFlags pass is up to 24 hours
 * away at deploy time and the dashboard is wrong for all of them. Adding a
 * category here corrects new and re-synced rows only -- rows already in the
 * database need a new migration. tests/transfers.test.ts asserts the two
 * lists agree, so a silent divergence fails the suite rather than the
 * household's totals.
 */
export const TRANSFER_PLUGGY_CATEGORIES: ReadonlySet<string> = new Set([
  'Credit card payment',
  'Transfers',
  'Tax on financial operations',
  'Credit card fees',
])

export function isTransfer(pluggyCategory: string | null | undefined): boolean {
  if (!pluggyCategory) return false
  return TRANSFER_PLUGGY_CATEGORIES.has(pluggyCategory)
}
