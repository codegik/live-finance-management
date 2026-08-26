import { expect, it } from 'vitest'
import { rowTone } from '@/components/MonthBlock'
import { cellClass } from '@/components/YearGrid'
import type { MonthRow } from '@/lib/views/month'

/**
 * `rowTone` is the entire delivery of "a row over its plan and a row whose
 * *pace* is over its plan are rendered differently, because they are different
 * problems: one has happened, the other is a forecast" -- and of the rule the
 * blocks added on top of it, that beating the plan is good news in Receita and
 * Investimento and bad news in the two expense blocks. Nothing else in the
 * codebase distinguishes any of these, so nothing else can regress them.
 */
function row(over: Partial<MonthRow>): MonthRow {
  return {
    categoryId: 'c1',
    categoryName: 'Supermercado',
    group: 'DESPESA_VARIAVEL',
    actualCents: 0,
    plannedCents: 100_000,
    plannedFrom: null,
    variableCents: 0,
    committedCents: 0,
    paceCents: 0,
    transactions: [],
    transactionCount: 0,
    ...over,
  }
}

it('paints a row inside its plan and inside its pace plainly', () => {
  expect(rowTone(row({ actualCents: 30_000, paceCents: 90_000 }), 'CURRENT')).toBe('plain')
})

it('marks a row merely forecast to go over as a forecast', () => {
  expect(rowTone(row({ actualCents: 30_000, paceCents: 130_000 }), 'CURRENT')).toBe('pacing-over')
})

it('marks a row that is already over as already over', () => {
  expect(rowTone(row({ actualCents: 130_000, paceCents: 130_000 }), 'CURRENT')).toBe('over')
})

it('does not forecast a closed month', () => {
  // The pace of a past month is its actual, but even if it were not, a
  // forecast about June read in August is not a warning about anything.
  expect(rowTone(row({ actualCents: 30_000, paceCents: 130_000 }), 'PAST')).toBe('plain')
})

it('draws no comparison for a row with no plan', () => {
  expect(rowTone(row({ actualCents: 999_999, plannedCents: null }), 'CURRENT')).toBe('plain')
})

it('treats beating the plan as good news in Receita', () => {
  expect(rowTone(row({ group: 'RECEITA', actualCents: 130_000 }), 'CURRENT')).toBe('good')
  expect(rowTone(row({ group: 'RECEITA', actualCents: 70_000 }), 'CURRENT')).toBe('plain')
})

it('treats investing more than planned as good news, not as overspending', () => {
  expect(rowTone(row({ group: 'INVESTIMENTO', actualCents: 130_000 }), 'CURRENT')).toBe('good')
})

it('never paints a Receita row as overspent, however far past the plan it is', () => {
  expect(rowTone(row({ group: 'RECEITA', actualCents: 10_000_000 }), 'CURRENT')).not.toBe('over')
})

// --- The same rule, one column narrower --------------------------------

it('colours a year cell over its plan by whether more is better', () => {
  const cell = { period: '2026-08', actualCents: 130_000, plannedCents: 100_000 }
  // Over plan when overspending is bad -> red; the same overshoot when more is
  // better -> green.
  expect(cellClass(cell, false)).toBe('text-neg')
  expect(cellClass(cell, true)).toBe('text-pos')
})

it('leaves an empty year cell unmarked rather than calling it under plan', () => {
  // A month with no spend is not an achievement; painting it green would make
  // a whole unused row read as a year of wins -- it reads faint instead.
  expect(cellClass({ period: '2026-08', actualCents: 0, plannedCents: 100_000 }, false)).toBe(
    'text-text-faint',
  )
})
