/**
 * Pluggy reports amounts as positive decimals with the direction in `type`.
 * Internally, positive centavos means money spent and negative means money
 * returned, so a budget is always a sum of the same-signed quantity.
 *
 * VERIFY AGAINST REAL DATA before production: confirm that a card purchase
 * arrives as type DEBIT and an estorno as type CREDIT for both issuers.
 */
export function toCentavos(amount: number, type: 'DEBIT' | 'CREDIT'): number {
  const cents = Math.round(Math.abs(amount) * 100)
  return type === 'CREDIT' ? -cents : cents
}
