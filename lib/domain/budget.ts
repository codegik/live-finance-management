/**
 * Every figure the dashboard shows is decided here, with no I/O.
 *
 * There is deliberately no timezone handling in this module. `transaction.date`
 * was bucketed to America/Sao_Paulo once, at ingest, in Slice 1 -- so month
 * membership is plain `YYYY-MM-DD` string comparison. Re-applying a zone to a
 * stored calendar date is how a late-night purchase on the 31st ends up in
 * the wrong month twice.
 */

/** A period is `YYYY-MM`. */
function parsePeriod(period: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  if (!match) throw new Error(`INVALID_PERIOD:${period}`)
  const month = Number(match[2])
  if (month < 1 || month > 12) throw new Error(`INVALID_PERIOD:${period}`)
  return { year: Number(match[1]), month }
}

function formatPeriod(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

/** Day 0 of the next month is the last day of this one, leap years included. */
export function daysInPeriod(period: string): number {
  const { year, month } = parsePeriod(period)
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function monthBounds(period: string): { start: string; end: string } {
  const { year, month } = parsePeriod(period)
  const last = daysInPeriod(period)
  const mm = String(month).padStart(2, '0')
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(last).padStart(2, '0')}`,
  }
}

export function addMonths(period: string, months: number): string {
  const { year, month } = parsePeriod(period)
  const zeroBased = year * 12 + (month - 1) + months
  return formatPeriod(Math.floor(zeroBased / 12), (zeroBased % 12) + 1)
}

export type BudgetPeriodRow = {
  /** The stored `period_month`, always a first-of-month `YYYY-MM-DD`. */
  periodMonth: string
  amountCents: number
}

/**
 * The budget for a category in a month: the row for that month if one exists,
 * otherwise the most recent row before it, otherwise none.
 *
 * Resolved here rather than by writing future rows, so editing one month
 * affects every later month with no row of its own and no backfill job can
 * leave stale amounts behind.
 */
export function resolveBudget(rows: BudgetPeriodRow[], period: string): number | null {
  const { start } = monthBounds(period)

  let best: BudgetPeriodRow | null = null
  for (const row of rows) {
    if (row.periodMonth > start) continue
    if (!best || row.periodMonth > best.periodMonth) best = row
  }

  return best ? best.amountCents : null
}

export type PaceInput = {
  /** Non-instalment spend so far this month. */
  variableCents: number
  /** Every instalment in this month, plus anything else dated later in it. */
  committedCents: number
  dayOfMonth: number
  daysInPeriod: number
}

/**
 * An end-of-month projection.
 *
 * Variable spending extrapolates because it is a rate. Instalments do not,
 * because they are a known list. Without the split a single R$1,147 car
 * instalment seen on the 10th projects R$3,556 of car spend by month end --
 * the false alarm that trains a household to ignore the number.
 */
export function pace(input: PaceInput): number {
  const elapsed = Math.max(1, input.dayOfMonth)
  const projectedVariable = Math.round((input.variableCents / elapsed) * input.daysInPeriod)
  return projectedVariable + input.committedCents
}

/**
 * The suggested budget for a category: the median of its complete months.
 *
 * The caller supplies one entry per complete month INCLUDING months with no
 * spend, so a category active in three months of nine is not budgeted at the
 * average of its active months. Median rather than mean so one R$1,147 car
 * month does not set the car budget for the year.
 */
export function medianMonthlySpend(monthlyTotals: number[]): number | null {
  if (monthlyTotals.length === 0) return null

  const sorted = [...monthlyTotals].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}
