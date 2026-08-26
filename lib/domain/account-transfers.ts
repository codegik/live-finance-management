/**
 * Pairing the two legs of a transfer between the household's own bank accounts.
 *
 * This is the sibling of lib/domain/card-payments.ts, for the case that file
 * does not cover: money moved from one connected checking account to another.
 * Pluggy records it twice -- an outgoing debit on the sending account and an
 * arriving credit on the receiving one -- and both accounts are the household's,
 * so both legs are in the database. classifyRole (lib/domain/budget-role.ts)
 * reads a bank row by direction and gets SPEND for the leg that left and INCOME
 * for the leg that arrived, so the same money inflates Despesas on one side and
 * Receita on the other. netCents stays right; both totals are overstated.
 *
 * Like the card-payment pairing, this does NOT guess from a category string --
 * 'Transfers', 'Same person transfer', a string Pluggy invents next year -- for
 * the reason budget-role.ts sets out at length: a missed string is a wrong total
 * that nothing on screen admits to. It pairs on a FACT about two rows: an
 * outgoing bank debit equal to the centavo, on the same day, to an arriving bank
 * credit on a DIFFERENT one of the household's accounts. Two legs of one move.
 *
 * THE FALSE-POSITIVE this accepts, stated plainly: unlike a card payment, whose
 * card leg carries a 'Credit card payment' tag that proves the bank leg, a
 * bank-to-bank transfer has no such anchor. So a genuine expense of R$X leaving
 * one account the same day a genuine, unrelated R$X arrives at another would be
 * paired and both hidden -- an invisible understatement, the one failure mode
 * budget-role.ts works hardest to avoid. Exact date and exact centavo make a
 * coincidental collision rare, and the pairing self-heals: it re-derives every
 * night, so if either leg later moves or is deleted the other returns to its
 * direction-derived role. Where a real transfer is NOT caught -- legs a day
 * apart, an amount that differs by a fee -- the household files either leg under
 * the 'Transferência entre contas' category by hand and it leaves the totals the
 * same way (see lib/domain/seed-categories.ts). A caught false positive is
 * corrected the same way, in reverse.
 */

/** Positive centavos for money out, negative for money in (lib/domain/money.ts). */
export type TransferRow = {
  id: string
  /** Which of the household's accounts the row sits on. */
  accountId: string
  accountType: 'CREDIT' | 'BANK'
  amountCents: number
  /** 'YYYY-MM-DD'. */
  date: string
}

/** `2026-08-06` + `942500` (abs centavos) -- a transfer's fingerprint. */
function key(date: string, absCents: number): string {
  return `${date}|${absCents}`
}

/**
 * The ids of BOTH legs of every own-account transfer -- the outgoing debit and
 * the arriving credit -- which must leave every total as TRANSFER.
 *
 * Only BANK rows are considered: a leg on a CREDIT account is a card settlement,
 * which card-payments.ts pairs on its own stronger evidence. Pass those already
 * paired ids as `exclude` so an outgoing fatura payment is never also consumed
 * here by a coincidental equal credit.
 *
 * Matched as a multiset, consumed one-for-one and deterministically: an outgoing
 * R$X on a day claims exactly one arriving R$X of the same day on another
 * account, never two, and the choice among equal candidates is fixed by id so
 * the result does not change between runs. A transfer between the same account
 * (a rare same-day deposit and withdrawal of equal value) never pairs -- the two
 * legs must sit on different accounts, which is what makes this a MOVE rather
 * than an in-and-out.
 */
export function pairedOwnTransferIds(
  rows: readonly TransferRow[],
  opts: { exclude?: ReadonlySet<string> } = {},
): Set<string> {
  const exclude = opts.exclude ?? new Set<string>()

  // Arriving bank legs, grouped by fingerprint and ordered so the pick is
  // deterministic when several credits share a day and an amount.
  const incomingByKey = new Map<string, TransferRow[]>()
  for (const row of rows) {
    if (row.accountType !== 'BANK' || row.amountCents >= 0 || exclude.has(row.id)) continue
    const k = key(row.date, Math.abs(row.amountCents))
    const list = incomingByKey.get(k) ?? []
    list.push(row)
    incomingByKey.set(k, list)
  }
  for (const list of incomingByKey.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : 1))
  }

  const outgoing = rows
    .filter((row) => row.accountType === 'BANK' && row.amountCents > 0 && !exclude.has(row.id))
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1))

  const paired = new Set<string>()
  const consumed = new Set<string>()
  for (const out of outgoing) {
    const candidates = incomingByKey.get(key(out.date, Math.abs(out.amountCents)))
    if (!candidates) continue
    // The first unclaimed credit on a DIFFERENT account. Same-account pairs are
    // not a transfer between accounts; they are left to their own direction.
    const match = candidates.find((c) => !consumed.has(c.id) && c.accountId !== out.accountId)
    if (!match) continue
    consumed.add(match.id)
    paired.add(out.id)
    paired.add(match.id)
  }
  return paired
}
