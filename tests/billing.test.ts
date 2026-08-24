import { expect, it } from 'vitest'
import { billingPeriod, resolveBillingDays } from '@/lib/domain/billing'

/** The household's real card: closes on the 5th, falls due on the 17th. */
const card = { accountType: 'CREDIT' as const, closingDay: 5, dueDay: 17 }

it('moves a card purchase to the month its bill is paid', () => {
  // Bought 10/08 -> bill closes 05/09, due 17/09. The money leaves in
  // September, so September is where the household budgets it.
  expect(billingPeriod({ ...card, date: '2026-08-10', installmentNumber: null })).toBe('2026-09')
})

it('keeps a purchase made before the closing day on the bill already closing', () => {
  // Bought 03/08, before the 5th -> that bill closes 05/08 and is due 17/08.
  expect(billingPeriod({ ...card, date: '2026-08-03', installmentNumber: null })).toBe('2026-08')
})

it('does not shift an instalment the connector already billed', () => {
  // VERIFIED AGAINST REAL DATA: instalments 2..N arrive dated the 15th of the
  // month they are charged. Shifting them would push every parcela a month
  // late and silently double-count the boundary month.
  expect(billingPeriod({ ...card, date: '2026-09-15', installmentNumber: 6 })).toBe('2026-09')
})

it('shifts the first instalment, which carries a real purchase date', () => {
  // Instalment 1 is the purchase itself and lands on every day of the month.
  expect(billingPeriod({ ...card, date: '2026-08-11', installmentNumber: 1 })).toBe('2026-09')
})

it('keeps a parcela series in consecutive months across the boundary', () => {
  // 01/02 bought 11/08 -> paid September. 02/02 dated 15/10 -> paid October.
  // A rule that shifted both, or neither, would put them in the same month or
  // two months apart.
  const first = billingPeriod({ ...card, date: '2026-08-11', installmentNumber: 1 })
  const second = billingPeriod({ ...card, date: '2026-10-15', installmentNumber: 2 })
  expect([first, second]).toEqual(['2026-09', '2026-10'])
})

it('leaves a bank transaction in the month it happened', () => {
  // A PIX, a TED, a salary: it settles the day it happens. No bill, no shift.
  expect(
    billingPeriod({ accountType: 'BANK', closingDay: 5, dueDay: 17, date: '2026-08-10', installmentNumber: null }),
  ).toBe('2026-08')
})

it('does not invent a cycle when the closing day is unknown', () => {
  // Pluggy left closing_day null on the live card. A guessed cycle moves money
  // into the wrong month and looks exactly like a correct answer, so this
  // falls back to the transaction's own month until the household sets one.
  expect(
    billingPeriod({ accountType: 'CREDIT', closingDay: null, dueDay: 17, date: '2026-08-10', installmentNumber: null }),
  ).toBe('2026-08')
})

it('rolls into the next year at the December boundary', () => {
  expect(billingPeriod({ ...card, date: '2026-12-20', installmentNumber: null })).toBe('2027-01')
})

it('pays next month when the bill falls due before it closes', () => {
  // Closes on the 25th, due on the 5th: that bill is paid the following month.
  const late = { accountType: 'CREDIT' as const, closingDay: 25, dueDay: 5 }
  expect(billingPeriod({ ...late, date: '2026-08-10', installmentNumber: null })).toBe('2026-09')
  expect(billingPeriod({ ...late, date: '2026-08-28', installmentNumber: null })).toBe('2026-10')
})

it('prefers the household override to whatever the connector said', () => {
  // Not an edge case: Pluggy supplied due_day and left closing_day null, so
  // the override is the only closing day this household has.
  expect(
    resolveBillingDays({ dueDay: 17, closingDay: null, dueDayOverride: null, closingDayOverride: 5 }),
  ).toEqual({ dueDay: 17, closingDay: 5 })
  expect(
    resolveBillingDays({ dueDay: 17, closingDay: 28, dueDayOverride: 10, closingDayOverride: 5 }),
  ).toEqual({ dueDay: 10, closingDay: 5 })
})
