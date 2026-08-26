import { expect, it } from 'vitest'
import { pairedOwnTransferIds, type TransferRow } from '@/lib/domain/account-transfers'

/** Money out is positive centavos, money in negative (lib/domain/money.ts). */
function bank(id: string, accountId: string, date: string, amountCents: number): TransferRow {
  return { id, accountId, accountType: 'BANK', date, amountCents }
}
function card(id: string, accountId: string, date: string, amountCents: number): TransferRow {
  return { id, accountId, accountType: 'CREDIT', date, amountCents }
}

it('pairs an outgoing debit to the arriving credit on another own account', () => {
  // The transaction from prod: R$9.425,00 leaving Nubank the same day it lands
  // on a second connected account. Both legs must leave the totals.
  const rows = [
    bank('out', 'nubank', '2026-08-06', 942_500),
    bank('in', 'other', '2026-08-06', -942_500),
  ]
  expect(pairedOwnTransferIds(rows)).toEqual(new Set(['out', 'in']))
})

it('does not pair legs on the same account -- that is an in-and-out, not a move', () => {
  const rows = [
    bank('deposit', 'nubank', '2026-08-06', -500_00),
    bank('withdraw', 'nubank', '2026-08-06', 500_00),
  ]
  expect(pairedOwnTransferIds(rows)).toEqual(new Set())
})

it('does not pair when the amounts differ by a centavo', () => {
  const rows = [
    bank('out', 'a', '2026-08-06', 500_00),
    bank('in', 'b', '2026-08-06', -500_01),
  ]
  expect(pairedOwnTransferIds(rows)).toEqual(new Set())
})

it('does not pair legs a day apart -- exact date only', () => {
  const rows = [
    bank('out', 'a', '2026-08-06', 500_00),
    bank('in', 'b', '2026-08-07', -500_00),
  ]
  expect(pairedOwnTransferIds(rows)).toEqual(new Set())
})

it('never touches a CREDIT leg -- those are card settlements', () => {
  const rows = [
    bank('out', 'a', '2026-08-06', 500_00),
    card('cardcredit', 'card', '2026-08-06', -500_00),
  ]
  expect(pairedOwnTransferIds(rows)).toEqual(new Set())
})

it('consumes one-for-one: two equal debits, one credit, only one pair', () => {
  const rows = [
    bank('out1', 'a', '2026-08-06', 500_00),
    bank('out2', 'a', '2026-08-06', 500_00),
    bank('in', 'b', '2026-08-06', -500_00),
  ]
  // 'out1' sorts before 'out2', so it deterministically claims the sole credit.
  expect(pairedOwnTransferIds(rows)).toEqual(new Set(['out1', 'in']))
})

it('pairs two genuine transfers of the same amount and day across accounts', () => {
  const rows = [
    bank('outA', 'a', '2026-08-06', 500_00),
    bank('inB', 'b', '2026-08-06', -500_00),
    bank('outC', 'c', '2026-08-06', 500_00),
    bank('inD', 'd', '2026-08-06', -500_00),
  ]
  expect(pairedOwnTransferIds(rows)).toEqual(new Set(['outA', 'inB', 'outC', 'inD']))
})

it('leaves an outgoing debit with no matching credit alone', () => {
  // A real PIX to a person: money left, nothing of equal value arrived on an
  // own account, so it stays whatever direction made it (SPEND).
  const rows = [bank('pix', 'a', '2026-08-06', 500_00), bank('groceries', 'a', '2026-08-06', 89_90)]
  expect(pairedOwnTransferIds(rows)).toEqual(new Set())
})

it('does not consume a leg already paired as a card payment', () => {
  // The card-payment pass claims 'fatura' first; excluding it stops a
  // coincidental equal credit from also pairing it here.
  const rows = [
    bank('fatura', 'a', '2026-08-06', 500_00),
    bank('coincidence', 'b', '2026-08-06', -500_00),
  ]
  const excluded = pairedOwnTransferIds(rows, { exclude: new Set(['fatura']) })
  expect(excluded).toEqual(new Set())
  // Without the exclusion the two would have paired -- proving the guard is
  // what prevented it, not the data.
  expect(pairedOwnTransferIds(rows)).toEqual(new Set(['fatura', 'coincidence']))
})
