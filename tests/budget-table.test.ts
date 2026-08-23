import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { barClass, BudgetTable } from '@/components/BudgetTable'
import type { DashboardRow } from '@/lib/views/dashboard'

/**
 * `barClass` is the entire delivery of the spec's "a row over budget and a row
 * whose *pace* is over budget are rendered differently, because they are
 * different problems: one has happened, the other is a forecast". Nothing
 * else in the codebase distinguishes them, so nothing else can regress it.
 */
function row(over: Partial<DashboardRow>): DashboardRow {
  return {
    categoryId: 'c1',
    categoryName: 'Supermercado',
    spentCents: 0,
    variableCents: 0,
    committedCents: 0,
    budgetCents: 100_000,
    paceCents: 0,
    ...over,
  }
}

it('paints a row inside its budget and inside its pace plainly', () => {
  expect(barClass(row({ spentCents: 30_000, paceCents: 90_000 }))).toBe('budget__bar')
})

it('marks a row merely forecast to go over as a forecast', () => {
  expect(barClass(row({ spentCents: 30_000, paceCents: 130_000 }))).toBe(
    'budget__bar budget__bar--pacing-over',
  )
})

it('marks a row that is already over as already over', () => {
  expect(barClass(row({ spentCents: 130_000, paceCents: 130_000 }))).toBe(
    'budget__bar budget__bar--over',
  )
})

it('lets "already over" win over "forecast to go over"', () => {
  // Both conditions hold on any row that has overspent -- pace includes the
  // spend it extrapolates from. If the forecast branch ran first, a household
  // that has ALREADY overspent would be shown a warning about the future
  // instead of a statement about the present.
  const already = row({ spentCents: 150_000, paceCents: 400_000 })

  expect(already.paceCents).toBeGreaterThan(already.budgetCents!)
  expect(barClass(already)).toBe('budget__bar budget__bar--over')
})

it('never marks a category with no budget, which has nothing to be over', () => {
  expect(barClass(row({ budgetCents: null, spentCents: 500_000, paceCents: 900_000 }))).toBe(
    'budget__bar',
  )
})

it('does not treat spending exactly the budget as over it', () => {
  expect(barClass(row({ spentCents: 100_000, paceCents: 100_000 }))).toBe('budget__bar')
})

function render(rows: DashboardRow[]): string {
  return renderToStaticMarkup(createElement(BudgetTable, { rows }))
}

it('draws no track at all for a category with no budget', () => {
  // A 0% bar in a visible track says "you have spent none of your budget",
  // which is a different statement from "you have no budget" -- and it
  // collapses the distinction against a real budget with no spend yet,
  // whose empty track IS information.
  const markup = render([row({ budgetCents: null, spentCents: 40_000 })])

  expect(markup).toContain('no budget')
  expect(markup).not.toContain('budget__track')
})

it('still draws an empty track for a budget with nothing spent', () => {
  const markup = render([row({ budgetCents: 100_000, spentCents: 0 })])

  expect(markup).toContain('budget__track')
  expect(markup).toContain('width:0%')
})

it('never gives the bar a negative width in a refund-heavy month', () => {
  // Net spend goes negative when estornos outweigh purchases, and an
  // unclamped percentage renders as `width: -12%`.
  const markup = render([row({ budgetCents: 100_000, spentCents: -12_000 })])

  expect(markup).not.toMatch(/width:\s*-/)
  expect(markup).toContain('width:0%')
})
