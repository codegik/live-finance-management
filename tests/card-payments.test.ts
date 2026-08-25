import { expect, it } from 'vitest'
import { pairedBankPaymentIds, type PairingRow } from '@/lib/domain/card-payments'

/** Money out is positive centavos, money in negative (lib/domain/money.ts). */
function card(id: string, date: string, amountCents: number, pluggyCategory: string | null): PairingRow {
  return { id, accountType: 'CREDIT', date, amountCents, pluggyCategory }
}
function bank(id: string, date: string, amountCents: number, pluggyCategory: string | null): PairingRow {
  return { id, accountType: 'BANK', date, amountCents, pluggyCategory }
}

it('pairs a bank debit to the card settlement it pays', () => {
  // VERIFIED AGAINST REAL DATA: 2026-04-08, the LATAM card's fatura. The card
  // records a -R$24.446,75 'Credit card payment'; the same day Nubank shows a
  // +R$24.446,75 'Pagamento efetuado | ITAU UNIBANCO' the connector calls
  // 'Transfers'. The bank leg is the one being double-counted.
  const rows = [
    card('c1', '2026-04-08', -2_444_675, 'Credit card payment'),
    bank('b1', '2026-04-08', 2_444_675, 'Transfers'),
  ]
  expect(pairedBankPaymentIds(rows)).toEqual(new Set(['b1']))
})

it('leaves an unlinked card untouched -- its payment is the only record of that spend', () => {
  // The C6 card in the same data (~R$88k) is not connected, so there is no
  // 'Credit card payment' to pair against. Its bank payment must stay SPEND: the
  // purchases behind it are nowhere in the database, so excluding it would erase
  // real spending from every total. String matching on 'Pagamento efetuado'
  // would have caught it; pairing is blind to it by construction.
  const rows = [
    bank('b_c6', '2025-10-07', 2_896_614, 'Transfers'), // Pagamento efetuado | BANCO C6
    card('c_itau', '2025-10-09', -349_606, 'Credit card payment'),
  ]
  expect(pairedBankPaymentIds(rows)).toEqual(new Set())
})

it('pairs both a large and a tiny fatura on the same account', () => {
  const rows = [
    card('c_latam', '2026-06-08', -2_106_989, 'Credit card payment'),
    bank('b_latam', '2026-06-08', 2_106_989, 'Transfers'),
    card('c_ultra', '2026-06-15', -9_614, 'Credit card payment'),
    bank('b_ultra', '2026-06-15', 9_614, 'Pagamento de fatura' as unknown as string),
  ]
  expect(pairedBankPaymentIds(rows)).toEqual(new Set(['b_latam', 'b_ultra']))
})

it('never marks two bank debits for one settlement', () => {
  // One card payment can only be the other leg of one bank debit. A genuine
  // expense that happens to equal a fatura to the centavo on its exact day keeps
  // its place -- there is no unclaimed settlement to account for it.
  const rows = [
    card('c1', '2026-05-08', -1_314_215, 'Credit card payment'),
    bank('b1', '2026-05-08', 1_314_215, 'Transfers'),
    bank('b2', '2026-05-08', 1_314_215, 'Shopping'), // a real coincidental expense
  ]
  const paired = pairedBankPaymentIds(rows)
  expect(paired.size).toBe(1)
  // Deterministic: the earlier id is claimed.
  expect(paired).toEqual(new Set(['b1']))
})

it('claims one bank debit per settlement when several settlements match', () => {
  const rows = [
    card('c1', '2026-05-08', -1_000_00, 'Credit card payment'),
    card('c2', '2026-05-08', -1_000_00, 'Credit card payment'),
    bank('b1', '2026-05-08', 1_000_00, 'Transfers'),
  ]
  // Two settlements, one bank debit: exactly one pairing, no phantom second.
  expect(pairedBankPaymentIds(rows)).toEqual(new Set(['b1']))
})

it('requires an exact amount and an exact date', () => {
  const rows = [
    card('c1', '2026-04-08', -2_444_675, 'Credit card payment'),
    bank('b_amount', '2026-04-08', 2_444_674, 'Transfers'), // one centavo off
    bank('b_date', '2026-04-09', 2_444_675, 'Transfers'), // one day off
  ]
  // Both fail: a window would swallow a coincidental equal expense nearby, and
  // missing an off-day payment fails safe (a visible SPEND, filable by hand).
  expect(pairedBankPaymentIds(rows)).toEqual(new Set())
})

it('never treats the card settlement itself as a bank payment', () => {
  // The card leg is already TRANSFER via classifyRole; it must not appear in the
  // paired set, or it would be counted as the thing it is being paired to.
  const rows = [card('c1', '2026-04-08', -2_444_675, 'Credit card payment')]
  expect(pairedBankPaymentIds(rows)).toEqual(new Set())
})

it('ignores money arriving on the bank account', () => {
  // A payment is outgoing. An arriving credit of the same magnitude -- a
  // redemption, a received PIX -- is not a fatura payment and must not pair.
  const rows = [
    card('c1', '2026-04-08', -2_444_675, 'Credit card payment'),
    bank('b_in', '2026-04-08', -2_444_675, 'Transfers'),
  ]
  expect(pairedBankPaymentIds(rows)).toEqual(new Set())
})

it('only pairs against a real credit-card settlement string', () => {
  // A bank debit equal to some OTHER card row (a purchase, an estorno) is not a
  // settlement and proves nothing.
  const rows = [
    card('c_purchase', '2026-04-08', 2_444_675, 'Groceries'),
    bank('b1', '2026-04-08', 2_444_675, 'Transfers'),
  ]
  expect(pairedBankPaymentIds(rows)).toEqual(new Set())
})
