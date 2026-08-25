/**
 * Pairing a bank-side invoice payment to the card settlement it pays.
 *
 * This is the fact-based half of the fatura-payment problem. classifyRole
 * (lib/domain/budget-role.ts) already excludes the CARD side of an invoice
 * payment -- Pluggy tags it 'Credit card payment' and it is TRANSFER on either
 * account -- but the BANK side is the debit that leaves checking to settle the
 * fatura, and Pluggy labels THAT 'Transfers', the same string an outgoing PIX
 * carries. classifyRole reads a bank 'Transfers' by direction and gets SPEND,
 * which is correct for a PIX and wrong for a fatura payment: the card purchases
 * it settles are already counted in the month their fatura falls due, so the
 * payment counts every one of them a second time.
 *
 * The design note in budget-role.ts is deliberate that no LIST OF STRINGS can
 * fix this -- 'Pagamento efetuado | ITAU', 'BANCO C6', a string Pluggy invents
 * next year -- because a missed string becomes a wrong total, silently. So this
 * does not guess from the string. It pairs on a FACT: a bank debit whose amount
 * and date match a settlement Pluggy already tagged 'Credit card payment' on one
 * of the household's own connected cards is that settlement's other leg. The
 * card leg proves the bank leg. The two are the same money.
 *
 * VERIFIED AGAINST REAL DATA (one live household): the 20 card-side 'Credit card
 * payment' rows total -R$178.076,75, and every one has a same-day, same-amount
 * debit on the Nubank checking account -- 'Pagamento efetuado | ITAU UNIBANCO'
 * for the LATAM card, 'Pagamento de fatura' for the Ultravioleta. Those bank
 * debits were all SPEND, double-counting R$178.076,75 of card purchases.
 *
 * WHY THIS CANNOT TOUCH AN UNLINKED CARD, which is the property that makes it
 * safe: a card the household never connected (a C6 in that same data, ~R$88k of
 * 'Pagamento efetuado | BANCO C6') has NO 'Credit card payment' row to pair
 * against, so its bank payment finds no match and stays SPEND -- exactly right,
 * because that payment is the ONLY record of C6 spending; the purchases behind
 * it are nowhere in the database. String matching would have caught 'Pagamento
 * efetuado' for both and made that R$88k of real spending vanish. Pairing is
 * blind to it by construction.
 *
 * Exact date, exact amount. A window would let a coincidental equal expense a
 * day or two away be swallowed, and the failure mode of missing a payment (a
 * visible SPEND the household can file by hand) is far safer than the failure
 * mode of hiding one (a real expense gone from every total with nothing on
 * screen to say so). Dates come from Pluggy already aligned; see the verified
 * data above.
 */

/** A credit-card settlement Pluggy tags on the CARD, whichever way it points. */
const CARD_PAYMENT_CATEGORY = 'Credit card payment'

export type PairingRow = {
  id: string
  accountType: 'CREDIT' | 'BANK'
  pluggyCategory: string | null
  /** Positive centavos for money out, negative for money in. */
  amountCents: number
  /** 'YYYY-MM-DD'. */
  date: string
}

/** `2026-04-08` + `2444675` (abs centavos) -- a settlement's fingerprint. */
function key(date: string, amountCents: number): string {
  return `${date}|${Math.abs(amountCents)}`
}

/**
 * The ids of the BANK debits that are the other leg of a card settlement, and
 * so must leave every total as TRANSFER.
 *
 * Matched as a multiset, consumed one-for-one: two identical card payments on a
 * day claim two identical bank debits, but one card payment never marks two
 * bank debits -- a genuine expense that happens to equal a fatura to the centavo
 * on its exact day keeps its place unless there is a settlement left unclaimed
 * to account for it. Bank candidates are sorted so the choice of which equal row
 * is claimed is deterministic across runs.
 */
export function pairedBankPaymentIds(rows: readonly PairingRow[]): Set<string> {
  const settlements = new Map<string, number>()
  for (const row of rows) {
    if (row.accountType === 'CREDIT' && row.pluggyCategory === CARD_PAYMENT_CATEGORY) {
      const k = key(row.date, row.amountCents)
      settlements.set(k, (settlements.get(k) ?? 0) + 1)
    }
  }

  // Only outgoing bank rows can be a payment; an arriving credit never is.
  const candidates = rows
    .filter((row) => row.accountType === 'BANK' && row.amountCents > 0)
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1))

  const paired = new Set<string>()
  for (const row of candidates) {
    const k = key(row.date, row.amountCents)
    const remaining = settlements.get(k) ?? 0
    if (remaining > 0) {
      settlements.set(k, remaining - 1)
      paired.add(row.id)
    }
  }
  return paired
}
