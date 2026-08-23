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
 */
const INSTALLMENT = /(?:PARC(?:ELA)?\.?\s*)?(\d{1,2})\s*\/\s*(\d{1,2})/

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
