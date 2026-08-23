/**
 * Brazilian card statements spell an instalment inline: 'AUTO MECANICA BOA
 * 01/10', 'ZAFFARI CENTRO PARC 03/12', 'CLUBE LIVELO*Clube07/12'.
 *
 * VERIFIED AGAINST REAL DATA: on a live connection, 216 of 1,537 transactions
 * carry such a suffix, and every future-dated row is one of them. That is
 * what makes this parse load-bearing rather than cosmetic -- a row with an
 * instalment is money the household has already committed, which pace must
 * add at face value instead of extrapolating, and which the forward view is
 * entirely built from.
 *
 * Deliberately not stored as a synthesised projection: the connector supplies
 * the future parcelas itself, so there is nothing to generate.
 *
 * Word boundaries fail on `*Clube07/12` because the digits follow a word
 * character; we use negative lookaround guards instead to assert non-digit
 * neighbours. This allows digits glued to letters (like asterisk noise) but
 * rejects digits glued to digits (like parsing '10/12' from 'POSTO 44710/12').
 *
 * The trailing guard rejects a following SLASH as well as a following digit,
 * because a Brazilian date is spelled the same way an instalment is:
 * 'PAGTO 01/12/2024' would otherwise read as parcel 1 of 12, and any
 * DD/MM/YYYY with DD <= MM becomes a phantom commitment in the forward view
 * and is wrongly excluded from pace's variable extrapolation.
 */
const INSTALLMENT = /(?:PARC(?:ELA)?\.?\s*)?(?<!\d)(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/

export type Installment = { number: number; total: number }

export function parseInstallment(
  description: string | null | undefined,
): Installment | null {
  if (!description) return null

  const match = INSTALLMENT.exec(description.toUpperCase())
  if (!match) return null

  const number = Number(match[1])
  const total = Number(match[2])

  // A parcel runs 1..total, and a purchase in a single part is not an
  // instalment. Anything else is a date, a store number or noise that
  // happened to look like one -- storing it would put a phantom commitment
  // in the forward view.
  if (number < 1 || total < 2 || number > total) return null

  return { number, total }
}
