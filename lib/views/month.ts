import { listBudgets } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import type { Db } from '@/lib/db/client'
import { getHouseholdHealth, type HouseholdHealth } from '@/lib/db/health'
import { daysInPeriod, groupBudgetsByCategory, pace, resolveBudget } from '@/lib/domain/budget'
import { saoPauloPeriod, saoPauloToday } from '@/lib/domain/dates'
import {
  CATEGORY_GROUP_LABELS,
  CATEGORY_GROUPS,
  type CategoryGroup,
  GROUP_BUDGET_ROLE,
  toActualCents,
} from '@/lib/domain/seed-categories'
import { getCategorySpend } from './spend'

/** Where a period sits relative to the household's today. */
export type MonthStance = 'PAST' | 'CURRENT' | 'FUTURE'

export type MonthRow = {
  categoryId: string
  categoryName: string
  group: CategoryGroup
  /**
   * Always signed so that bigger means more: more spent for an expense,
   * more earned for Receita. Storage is the other way round for income
   * (lib/domain/money.ts), and the flip happens here, once.
   */
  actualCents: number
  plannedCents: number | null
  /** The month a carried-forward plan came from, or null if it is this month's own. */
  plannedFrom: string | null
  variableCents: number
  committedCents: number
  /**
   * What this row is expected to finish the month at. In a past month that is
   * simply what happened -- extrapolating a closed month would invent spending
   * that provably never occurred.
   */
  paceCents: number
}

export type MonthGroupView = {
  group: CategoryGroup
  label: string
  rows: MonthRow[]
  actualCents: number
  plannedCents: number
  paceCents: number
}

export type MonthView = {
  period: string
  stance: MonthStance
  /** 1..31 in the current month, the last day in a past one, 0 in a future one. */
  elapsedDays: number
  daysInMonth: number
  groups: MonthGroupView[]
  incomeCents: number
  investedCents: number
  /**
   * Everything that left the household that was not an investment: the fixed
   * and variable blocks, plus spend the blocks cannot draw -- uncategorized
   * rows and rows on archived categories.
   *
   * Taken from the AGGREGATE, never by summing `groups`. `groups` is built
   * from listCategories, which excludes archived categories, and archiving one
   * does not move the transactions pointing at it. Summing the drawn rows
   * would make that money vanish from the headline while /ledger still shows
   * it -- the two screens then disagree about the same month.
   */
  expenseCents: number
  /** SPEND this month that no drawn row accounts for: archived categories. */
  archivedSpentCents: number
  /** INCOME this month that no Receita row accounts for: uncategorized or archived. */
  unassignedIncomeCents: number
  plannedIncomeCents: number
  plannedInvestedCents: number
  plannedExpenseCents: number
  /** Earned minus invested minus spent. Negative means the month ate savings. */
  netCents: number
  plannedNetCents: number
  /** The sheet's "% da renda": what share of what came in was set aside. */
  investedShareOfIncome: number | null
  uncategorizedSpentCents: number
  uncategorizedCount: number
  health: HouseholdHealth
}

function stanceOf(period: string, current: string): MonthStance {
  if (period < current) return 'PAST'
  if (period > current) return 'FUTURE'
  return 'CURRENT'
}

/**
 * One month of the household's sheet: every category, what was planned for it
 * and what actually happened, grouped into the four blocks.
 *
 * This is the only place a month is assembled. The dashboard renders one, the
 * year grid renders twelve, and both read the same numbers from here -- a
 * second assembly is how the grid and the month screen would start disagreeing
 * about a cell the user just clicked through.
 */
export async function getMonthView(
  db: Db,
  householdId: string,
  period: string,
  opts: { now?: Date } = {},
): Promise<MonthView> {
  const now = opts.now ?? new Date()
  const today = saoPauloToday(now)
  const currentPeriod = saoPauloPeriod(now)
  const stance = stanceOf(period, currentPeriod)
  const daysInMonth = daysInPeriod(period)

  const [totals, categories, budgetRows, health] = await Promise.all([
    // Both roles in one query. Receita reads INCOME rows; every other block
    // reads SPEND. See GROUP_BUDGET_ROLE.
    getCategorySpend(db, householdId, period, today, { roles: ['SPEND', 'INCOME'] }),
    listCategories(db, householdId),
    listBudgets(db, householdId),
    getHouseholdHealth(db, householdId, opts),
  ])

  const elapsedDays =
    stance === 'PAST' ? daysInMonth : stance === 'FUTURE' ? 0 : Number(today.slice(8, 10))

  // Keyed on role as well as category: getCategorySpend groups by both, so a
  // category that somehow holds each would otherwise overwrite the other.
  const byCategoryRole = new Map(totals.map((t) => [`${t.categoryId}:${t.budgetRole}`, t]))
  const budgetsByCategory = groupBudgetsByCategory(budgetRows)

  const rows: MonthRow[] = categories.map((category) => {
    const group = category.group
    const role = GROUP_BUDGET_ROLE[group]
    const sums = byCategoryRole.get(`${category.id}:${role}`)

    // Income is stored negative, spend positive. One sign flip, so that every
    // consumer downstream can treat "bigger is more" as true.
    const actualCents = toActualCents(sums?.spentCents ?? 0, group)
    const variableCents = toActualCents(sums?.variableCents ?? 0, group)
    const committedCents = toActualCents(sums?.committedCents ?? 0, group)

    const budget = resolveBudget(budgetsByCategory.get(category.id) ?? [], period)

    return {
      categoryId: category.id,
      categoryName: category.name,
      group,
      actualCents,
      plannedCents: budget?.amountCents ?? null,
      plannedFrom:
        budget && budget.periodMonth.slice(0, 7) !== period ? budget.periodMonth.slice(0, 7) : null,
      variableCents,
      committedCents,
      paceCents:
        stance === 'PAST'
          ? actualCents
          : stance === 'FUTURE'
            ? // Nothing has been spent in a month that has not started. The
              // only honest figure is what is already committed to it.
              committedCents
            : pace({ variableCents, committedCents, dayOfMonth: elapsedDays, daysInPeriod: daysInMonth }),
    }
  })

  const groups: MonthGroupView[] = CATEGORY_GROUPS.map((group) => {
    const groupRows = rows.filter((row) => row.group === group)
    return {
      group,
      label: CATEGORY_GROUP_LABELS[group],
      rows: groupRows,
      actualCents: groupRows.reduce((sum, row) => sum + row.actualCents, 0),
      plannedCents: groupRows.reduce((sum, row) => sum + (row.plannedCents ?? 0), 0),
      paceCents: groupRows.reduce((sum, row) => sum + row.paceCents, 0),
    }
  })

  const byGroup = new Map(groups.map((g) => [g.group, g]))
  const actual = (group: CategoryGroup) => byGroup.get(group)?.actualCents ?? 0
  const planned = (group: CategoryGroup) => byGroup.get(group)?.plannedCents ?? 0

  // The accounting figures, straight off the aggregate. Every centavo the
  // household moved this month is in one of these two, drawn or not.
  const totalSpentCents = totals
    .filter((t) => t.budgetRole === 'SPEND')
    .reduce((sum, t) => sum + t.spentCents, 0)
  const totalIncomeCents = toActualCents(
    totals.filter((t) => t.budgetRole === 'INCOME').reduce((sum, t) => sum + t.spentCents, 0),
    'RECEITA',
  )

  const investedCents = actual('INVESTIMENTO')
  const incomeCents = totalIncomeCents
  const expenseCents = totalSpentCents - investedCents

  // What the blocks could not draw. Surfaced rather than dropped, so that the
  // rows on screen and the total above them add up to the same month.
  const drawnSpendCents =
    actual('INVESTIMENTO') + actual('DESPESA_FIXA') + actual('DESPESA_VARIAVEL')
  const plannedIncomeCents = planned('RECEITA')
  const plannedInvestedCents = planned('INVESTIMENTO')
  const plannedExpenseCents = planned('DESPESA_FIXA') + planned('DESPESA_VARIAVEL')

  // Uncategorized SPEND only. An uncategorized credit on a card is an estorno,
  // not income, and counting it as Receita would invent money.
  const uncategorized = byCategoryRole.get('null:SPEND')

  return {
    period,
    stance,
    elapsedDays,
    daysInMonth,
    groups,
    incomeCents,
    investedCents,
    expenseCents,
    archivedSpentCents:
      totalSpentCents - drawnSpendCents - (uncategorized?.spentCents ?? 0),
    unassignedIncomeCents: totalIncomeCents - actual('RECEITA'),
    plannedIncomeCents,
    plannedInvestedCents,
    plannedExpenseCents,
    netCents: incomeCents - investedCents - expenseCents,
    plannedNetCents: plannedIncomeCents - plannedInvestedCents - plannedExpenseCents,
    // Guarded rather than allowed to divide by zero: a month with no income
    // recorded yet must read as "not known", not as 0% or Infinity.
    investedShareOfIncome: incomeCents > 0 ? investedCents / incomeCents : null,
    uncategorizedSpentCents: uncategorized?.spentCents ?? 0,
    uncategorizedCount: uncategorized?.count ?? 0,
    health,
  }
}
