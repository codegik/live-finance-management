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
