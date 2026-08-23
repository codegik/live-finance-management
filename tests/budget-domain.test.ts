import { expect, it } from 'vitest'
import {
  addMonths,
  daysInPeriod,
  medianMonthlySpend,
  monthBounds,
  pace,
  resolveBudget,
} from '@/lib/domain/budget'
import { saoPauloPeriod, saoPauloToday } from '@/lib/domain/dates'

it('bounds a month as plain calendar dates', () => {
  expect(monthBounds('2026-08')).toEqual({ start: '2026-08-01', end: '2026-08-31' })
  expect(monthBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  // 2028 is a leap year; the bound must come from the calendar, not a table.
  expect(monthBounds('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
})

it('counts the days in a period', () => {
  expect(daysInPeriod('2026-08')).toBe(31)
  expect(daysInPeriod('2026-04')).toBe(30)
  expect(daysInPeriod('2028-02')).toBe(29)
})

it('walks months across a year boundary', () => {
  expect(addMonths('2026-11', 3)).toBe('2027-02')
  expect(addMonths('2026-01', -1)).toBe('2025-12')
})

it('reads the household calendar date and period from an instant', () => {
  // 02:30 UTC on the 1st is still the previous evening in Sao Paulo.
  const lateNight = new Date('2026-08-01T02:30:00.000Z')
  expect(saoPauloToday(lateNight)).toBe('2026-07-31')
  expect(saoPauloPeriod(lateNight)).toBe('2026-07')
})

it('carries a budget forward until a later month overrides it', () => {
  const rows = [
    { periodMonth: '2026-08-01', amountCents: 120_000 },
    { periodMonth: '2026-12-01', amountCents: 200_000 },
  ]

  expect(resolveBudget(rows, '2026-08')).toBe(120_000)
  expect(resolveBudget(rows, '2026-10')).toBe(120_000)
  expect(resolveBudget(rows, '2026-12')).toBe(200_000)
  expect(resolveBudget(rows, '2027-03')).toBe(200_000)
})

it('has no budget before the first one was ever set', () => {
  const rows = [{ periodMonth: '2026-08-01', amountCents: 120_000 }]

  // Not zero: "no budget" and "a budget of zero" are different statements,
  // and only one of them should draw a bar.
  expect(resolveBudget(rows, '2026-07')).toBeNull()
  expect(resolveBudget([], '2026-08')).toBeNull()
})

it('resolves independently of row order', () => {
  const rows = [
    { periodMonth: '2026-12-01', amountCents: 200_000 },
    { periodMonth: '2026-08-01', amountCents: 120_000 },
  ]

  expect(resolveBudget(rows, '2026-10')).toBe(120_000)
})

it('extrapolates variable spend but adds committed at face value', () => {
  // R$300 of day-to-day spend over 10 of 31 days, plus a R$1,147 instalment.
  const projected = pace({
    variableCents: 30_000,
    committedCents: 114_709,
    dayOfMonth: 10,
    daysInPeriod: 31,
  })

  // 30_000 / 10 * 31 = 93_000, plus the instalment untouched.
  expect(projected).toBe(93_000 + 114_709)
})

it('does not let a lone instalment imply a spending rate', () => {
  // The failure this split exists to prevent: extrapolating R$1,147 seen on
  // day 10 would project R$3,556 of car spend by month end.
  const projected = pace({
    variableCents: 0,
    committedCents: 114_709,
    dayOfMonth: 10,
    daysInPeriod: 31,
  })

  expect(projected).toBe(114_709)
})

it('does not divide by zero on the first of the month', () => {
  expect(pace({ variableCents: 5_000, committedCents: 0, dayOfMonth: 1, daysInPeriod: 31 })).toBe(
    155_000,
  )
  expect(pace({ variableCents: 5_000, committedCents: 0, dayOfMonth: 0, daysInPeriod: 31 })).toBe(
    155_000,
  )
})

it('returns whole centavos', () => {
  const projected = pace({
    variableCents: 10_000,
    committedCents: 0,
    dayOfMonth: 7,
    daysInPeriod: 31,
  })

  expect(Number.isInteger(projected)).toBe(true)
})

it('takes the median of complete months, zeros included', () => {
  // A category spent in only three of six months should not be budgeted at
  // the average of the months it was active.
  expect(medianMonthlySpend([0, 0, 0, 30_000, 40_000, 50_000])).toBe(15_000)
  expect(medianMonthlySpend([10_000, 30_000, 20_000])).toBe(20_000)
})

it('has no suggestion without history', () => {
  expect(medianMonthlySpend([])).toBeNull()
})
