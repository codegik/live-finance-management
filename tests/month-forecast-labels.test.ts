import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { MonthBlock } from '@/components/MonthBlock'
import { MonthSummary } from '@/components/MonthSummary'
import { brl } from '@/lib/format'
import type { MonthGroupView, MonthRecurringLine, MonthRow, MonthView } from '@/lib/views/month'

/**
 * The figures fold the recurring bills still expected into what they compare
 * against the plan, so the screen has to say how much of each figure is a
 * forecast -- otherwise a category total that disagrees with the fatura goes
 * unexplained. These render the real components and read the markup.
 */

function line(over: Partial<MonthRecurringLine> = {}): MonthRecurringLine {
  return {
    id: 'r1',
    title: 'Topic',
    categoryId: 'c1',
    amountCents: 38_000,
    dayOfMonth: 10,
    date: '2026-10-10',
    estimated: false,
    matchType: 'CONTAINS',
    pattern: 'TOPIC',
    cadence: 'MONTHLY',
    ...over,
  }
}

function row(over: Partial<MonthRow> = {}): MonthRow {
  return {
    categoryId: 'c1',
    categoryName: 'Transporte',
    group: 'DESPESA_VARIAVEL',
    actualCents: 45_081,
    plannedCents: 50_000,
    plannedFrom: null,
    variableCents: 7_081,
    committedCents: 0,
    paceCents: 45_081,
    transactions: [],
    transactionCount: 0,
    recurringLines: [line()],
    recurringCents: 38_000,
    ...over,
  }
}

function block(rows: MonthRow[], group: MonthGroupView['group'] = 'DESPESA_VARIAVEL'): string {
  const view: MonthGroupView = {
    group,
    label: 'Bloco',
    rows,
    actualCents: rows.reduce((sum, r) => sum + r.actualCents, 0),
    plannedCents: rows.reduce((sum, r) => sum + (r.plannedCents ?? 0), 0),
    paceCents: rows.reduce((sum, r) => sum + r.paceCents, 0),
    recurringCents: rows.reduce((sum, r) => sum + r.recurringCents, 0),
  }
  return renderToStaticMarkup(
    createElement(MonthBlock, { group: view, stance: 'FUTURE', period: '2026-10', categories: [] }),
  )
}

const includes = (cents: number) => `inclui ${brl(cents)} previsto`

/** The block header and everything under it (the category rows), apart. */
function split(markup: string): { header: string; rows: string } {
  const [header, rows] = markup.split('</header>')
  return { header, rows }
}

it('notes the forecast once, on the block header, summing its rows', () => {
  const markup = block([
    row(),
    row({ categoryId: 'c2', categoryName: 'Educação', recurringLines: [line({ id: 'r2', amountCents: 10_000 })], recurringCents: 10_000 }),
  ])
  const { header, rows } = split(markup)
  expect(header).toContain(includes(48_000))
  // No category repeats it.
  expect(rows).not.toContain('inclui')
})

it('leaves the forecast note off a category that also has charges (the row that opens)', () => {
  const { header, rows } = split(block([row({ transactionCount: 5 })]))
  expect(header).toContain(includes(38_000))
  expect(rows).not.toContain('inclui')
})

it('still badges each expected bill in the opened list', () => {
  // The per-bill forecast stays visible where the bills are listed.
  const { rows } = split(block([row()]))
  expect(rows).toContain('Topic')
  expect(rows).toContain('previsto')
})

it('draws no forecast note on a row or block with nothing expected', () => {
  const markup = block([row({ recurringLines: [], recurringCents: 0, transactionCount: 3 })])
  expect(markup).not.toContain('inclui')
  expect(markup).not.toContain('previsto')
})

it('keeps a Receita forecast worded as outside the figure', () => {
  const markup = block(
    [row({ group: 'RECEITA', actualCents: 0, paceCents: 0, recurringLines: [line({ amountCents: 500_000 })], recurringCents: 500_000 })],
    'RECEITA',
  )
  const { header, rows } = split(markup)
  expect(header).toContain(`previsto ${brl(500_000)}`)
  expect(rows).not.toContain(`previsto ${brl(500_000)}`)
  expect(markup).not.toContain('inclui')
})

function summary(groups: Partial<Record<MonthGroupView['group'], number>>): string {
  const view = {
    incomeCents: 0,
    investedCents: 100_000,
    expenseCents: 45_081,
    netCents: -145_081,
    plannedIncomeCents: 0,
    plannedInvestedCents: 0,
    plannedExpenseCents: 0,
    groups: (['RECEITA', 'INVESTIMENTO', 'DESPESA_FIXA', 'DESPESA_VARIAVEL'] as const).map(
      (group) => ({ group, label: group, rows: [], actualCents: 0, plannedCents: 0, paceCents: 0, recurringCents: groups[group] ?? 0 }),
    ),
  } as unknown as MonthView
  return renderToStaticMarkup(createElement(MonthSummary, { view }))
}

it('shows the summary totals without a forecast note, even when bills are expected', () => {
  // The cards already include the forecast in their figures; the breakdown
  // belongs to the rows, not to the headline.
  const markup = summary({ RECEITA: 500_000, INVESTIMENTO: 100_000, DESPESA_FIXA: 5_500, DESPESA_VARIAVEL: 38_000 })
  expect(markup).toContain(brl(100_000))
  expect(markup).toContain(brl(45_081))
  expect(markup).not.toContain('previsto')
})
