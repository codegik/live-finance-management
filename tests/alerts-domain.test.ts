import { expect, it } from 'vitest'
import { type AlertRow, evaluateAlerts, type FiredAlert } from '@/lib/domain/alerts'

function row(over: Partial<AlertRow> = {}): AlertRow {
  return {
    categoryId: 'cat-1',
    categoryName: 'Supermercado',
    spentCents: 0,
    budgetCents: 100_000,
    ...over,
  }
}

it('fires at exactly 80 per cent', () => {
  const { toFire } = evaluateAlerts({ rows: [row({ spentCents: 80_000 })], fired: [] })

  expect(toFire).toEqual([
    {
      categoryId: 'cat-1',
      categoryName: 'Supermercado',
      threshold: 80,
      spentCents: 80_000,
      budgetCents: 100_000,
    },
  ])
})

it('does not fire a centavo below the threshold', () => {
  const { toFire } = evaluateAlerts({ rows: [row({ spentCents: 79_999 })], fired: [] })

  expect(toFire).toEqual([])
})

it('fires both thresholds when spend is already over budget', () => {
  const { toFire } = evaluateAlerts({ rows: [row({ spentCents: 120_000 })], fired: [] })

  // 100 before 80: the more serious line leads the message.
  expect(toFire.map((c) => c.threshold)).toEqual([100, 80])
})

it('does not re-fire a threshold that has already fired', () => {
  const fired: FiredAlert[] = [{ categoryId: 'cat-1', threshold: 80 }]
  const { toFire, toClear } = evaluateAlerts({ rows: [row({ spentCents: 85_000 })], fired })

  expect(toFire).toEqual([])
  expect(toClear).toEqual([])
})

it('clears a fired threshold once spend falls back under it', () => {
  const fired: FiredAlert[] = [{ categoryId: 'cat-1', threshold: 80 }]
  const { toFire, toClear } = evaluateAlerts({ rows: [row({ spentCents: 40_000 })], fired })

  expect(toFire).toEqual([])
  expect(toClear).toEqual([{ categoryId: 'cat-1', threshold: 80 }])
})

it('re-arms when the budget is raised out from under the crossing', () => {
  const fired: FiredAlert[] = [{ categoryId: 'cat-1', threshold: 80 }]
  const raised = row({ spentCents: 85_000, budgetCents: 200_000 })

  expect(evaluateAlerts({ rows: [raised], fired }).toClear).toEqual([
    { categoryId: 'cat-1', threshold: 80 },
  ])
})

it('never fires without a budget, and clears anything that had', () => {
  const fired: FiredAlert[] = [{ categoryId: 'cat-1', threshold: 100 }]
  const { toFire, toClear } = evaluateAlerts({
    rows: [row({ spentCents: 500_000, budgetCents: null })],
    fired,
  })

  expect(toFire).toEqual([])
  expect(toClear).toEqual([{ categoryId: 'cat-1', threshold: 100 }])
})

it('treats a zero budget as no budget rather than as instantly exceeded', () => {
  // Zero is what the budget editor's empty state produces. Alerting at 100%
  // on it would be noise, not a signal.
  const { toFire } = evaluateAlerts({ rows: [row({ spentCents: 1, budgetCents: 0 })], fired: [] })

  expect(toFire).toEqual([])
})

it('does not fire on negative spend', () => {
  const { toFire } = evaluateAlerts({ rows: [row({ spentCents: -50_000 })], fired: [] })

  expect(toFire).toEqual([])
})

it('clears state for a category that no longer appears at all', () => {
  // An archived category is dropped from the row set. Without this its fired
  // rows would survive forever, so un-archiving it could never alert again.
  const fired: FiredAlert[] = [{ categoryId: 'gone', threshold: 80 }]
  const { toClear } = evaluateAlerts({ rows: [row()], fired })

  expect(toClear).toEqual([{ categoryId: 'gone', threshold: 80 }])
})

it('orders crossings by threshold then category name', () => {
  const rows = [
    row({ categoryId: 'b', categoryName: 'Restaurantes', spentCents: 85_000 }),
    row({ categoryId: 'a', categoryName: 'Supermercado', spentCents: 130_000 }),
    row({ categoryId: 'c', categoryName: 'Farmacia', spentCents: 110_000 }),
  ]

  const { toFire } = evaluateAlerts({ rows, fired: [] })

  expect(toFire.map((c) => `${c.categoryName}:${c.threshold}`)).toEqual([
    'Farmacia:100',
    'Supermercado:100',
    'Farmacia:80',
    'Restaurantes:80',
    'Supermercado:80',
  ])
})
