/**
 * Brazilian card statements spell an instalment inline: 'AUTO MECANICA BOA
 * 01/10', 'ZAFFARI CENTRO PARC 03/12', 'CLUBE LIVELO*Clube07/12'.
 *
 * VERIFIED AGAINST REAL DATA: on a live connection, 216 of 1,537 transactions
 * carry such a suffix, and every future-dated row is one of them. That is
 * what makes this parse load-bearing rather than cosmetic. Two things turn on
 * it, and both are arithmetic rather than decoration:
 *
 *   pace() adds an instalment at face value and extrapolates everything else,
 *   because a parcela is a known list and variable spending is a rate. Without
 *   the flag a single R$1,147 car instalment seen on the 10th projects R$3,556
 *   by month end -- the false alarm that teaches a household to ignore the
 *   number.
 *
 *   lib/domain/billing.ts files a card row by the month it is paid, and skips
 *   the shift for instalments 2..N because the connector already dates those by
 *   the fatura they belong to. Read as an ordinary purchase, every parcela
 *   would land a month late.
 *
 * Deliberately not stored as a synthesised projection: the connector supplies
 * the future parcelas itself, so there is nothing to generate.
 *
 * Word boundaries fail on `*Clube07/12` because the digits follow a word
 * character; we use negative lookaround guards instead to assert non-digit
 * neighbours. This allows digits glued to letters (like asterisk noise) but
 * rejects digits glued to digits (like parsing '10/12' from 'POSTO 44710/12').
 *
 * The slash guards are SYMMETRIC -- a candidate may neither be followed nor
 * preceded by a slash -- because a Brazilian date is spelled the same way an
 * instalment is. The trailing guard alone stops 'PAGTO 01/12/24' matching at
 * '01/12', but the engine then just slides along and matches '12/24' as
 * parcel 12 of 24. Any DD/MM/YY(YY) with DD <= MM would otherwise become a
 * phantom commitment, be wrongly excluded from pace's variable extrapolation,
 * and skip the paying-month shift it should have had.
 */
const INSTALLMENT = /(?:PARC(?:ELA)?\.?\s*)?(?<![\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/

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
  // happened to look like one -- storing it would exempt an ordinary purchase
  // from the paying-month shift and from pace's extrapolation alike.
  if (number < 1 || total < 2 || number > total) return null

  return { number, total }
}
