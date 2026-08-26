import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { budgetMonthSql } from '@/lib/db/budget-month-sql'
import { accounts, connections, transactions } from '@/lib/db/schema'
import { listBudgets } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import type { Db } from '@/lib/db/client'
import { getHouseholdHealth, type HouseholdHealth } from '@/lib/db/health'
import {
  daysInPeriod,
  groupBudgetsByCategory,
  monthBounds,
  pace,
  resolveBudget,
} from '@/lib/domain/budget'
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

/** One transaction behind a category's figure, as the row's detail shows it. */
export type MonthTransaction = {
  id: string
  /**
   * Where this row is filed right now, which is not always where the list it
   * appears in is filed. The uncategorized and archived buckets are defined by
   * NOT matching a drawn row, so their lists mix a null with several retired
   * categories; the inline picker has to say which, per row, or it would
   * present an unfiled charge as already filed.
   */
  categoryId: string | null
  date: string
  /** Signed the same way the row is: bigger means more. */
  amountCents: number
  description: string
  accountName: string
  last4: string | null
  /** `3/10` when this is an instalment, null otherwise. */
  installment: string | null
}

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
  /**
   * The transactions this row's figure is made of.
   *
   * Capped at DETAIL_LIMIT. `actualCents` is an aggregate over every matching
   * row, so a category with a thousand of them would otherwise ship all
   * thousand to render a list nobody scrolls; the screen says when the list is
   * shorter than the figure it explains.
   */
  transactions: MonthTransaction[]
  /** True total behind `transactions`, which may be longer than the list. */
  transactionCount: number
}

/**
 * The rows behind one of the buckets that no drawn category row can carry.
 *
 * The figure itself stays where it always was (`uncategorizedSpentCents` and
 * friends), read off the aggregate; this only carries the rows it was summed
 * from, so the bucket can be opened like any category row instead of being a
 * dead line the household cannot interrogate. Same DETAIL_LIMIT cap and same
 * true `transactionCount` as MonthRow, for the same reason.
 */
export type MonthBucketDetail = {
  transactions: MonthTransaction[]
  transactionCount: number
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
  /**
   * The rows behind the three figures above that have no category row to sit
   * on. Each list is built from the exact complement of what the drawn rows
   * cover, so `sum(transactions) === <the matching *Cents>` whenever the list
   * is not truncated -- a bucket whose panel disagreed with its own header
   * would be worse than the dead line it replaced.
   */
  uncategorizedDetail: MonthBucketDetail
  archivedDetail: MonthBucketDetail
  unassignedIncomeDetail: MonthBucketDetail
  plannedIncomeCents: number
  plannedInvestedCents: number
  plannedExpenseCents: number
  /** Earned minus invested minus spent. Negative means the month ate savings. */
  netCents: number
  /** The sheet's "% da renda": what share of what came in was set aside. */
  investedShareOfIncome: number | null
  uncategorizedSpentCents: number
  uncategorizedCount: number
  health: HouseholdHealth
}

/** How many rows of a single category a month row will carry. */
const DETAIL_LIMIT = 200

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

  const { start: monthStart, end: monthEnd } = monthBounds(period)

  const [totals, detail, categories, budgetRows, health] = await Promise.all([
    // Both roles in one query. Receita reads INCOME rows; every other block
    // reads SPEND. See GROUP_BUDGET_ROLE.
    getCategorySpend(db, householdId, period, today, { roles: ['SPEND', 'INCOME'] }),
    // The rows behind the figures, in one query for the whole month rather
    // than one per category: the categories partition the same set the
    // aggregate above just summed.
    db
      .select({
        id: transactions.id,
        categoryId: transactions.categoryId,
        budgetRole: transactions.budgetRole,
        date: transactions.date,
        amountCents: transactions.amountCents,
        description: transactions.description,
        installmentNumber: transactions.installmentNumber,
        installmentTotal: transactions.installmentTotal,
        accountName: accounts.name,
        last4: accounts.last4,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .where(
        and(
          eq(connections.householdId, householdId),
          inArray(transactions.budgetRole, ['SPEND', 'INCOME']),
          gte(budgetMonthSql, monthStart),
          lte(budgetMonthSql, monthEnd),
        ),
      )
      .orderBy(desc(transactions.date), desc(transactions.id)),
    listCategories(db, householdId),
    listBudgets(db, householdId),
    getHouseholdHealth(db, householdId, opts),
  ])

  const elapsedDays =
    stance === 'PAST' ? daysInMonth : stance === 'FUTURE' ? 0 : Number(today.slice(8, 10))

  // Keyed on role as well as category: getCategorySpend groups by both, so a
  // category that somehow holds each would otherwise overwrite the other.
  const byCategoryRole = new Map(totals.map((t) => [`${t.categoryId}:${t.budgetRole}`, t]))

  // One mapper for every list built out of `detail` -- the category rows and
  // the buckets below. The income sign flip in particular has to happen
  // exactly once and identically everywhere: a bucket listing -R$ 4.000,00
  // under a header reading R$ 4.000,00 is how the panel starts contradicting
  // the figure that opened it.
  const toMonthTransaction = (row: (typeof detail)[number]): MonthTransaction => ({
    id: row.id,
    categoryId: row.categoryId,
    date: row.date,
    amountCents:
      row.budgetRole === 'INCOME' ? toActualCents(row.amountCents, 'RECEITA') : row.amountCents,
    description: row.description,
    accountName: row.accountName,
    last4: row.last4,
    installment:
      row.installmentNumber && row.installmentTotal
        ? `${row.installmentNumber}/${row.installmentTotal}`
        : null,
  })

  // The detail rows, keyed the same way, so a row's list is drawn from exactly
  // the rows its figure was summed from.
  const detailByCategoryRole = new Map<string, MonthTransaction[]>()
  const countByCategoryRole = new Map<string, number>()
  for (const row of detail) {
    const key = `${row.categoryId}:${row.budgetRole}`
    countByCategoryRole.set(key, (countByCategoryRole.get(key) ?? 0) + 1)
    const list = detailByCategoryRole.get(key) ?? []
    if (list.length < DETAIL_LIMIT) list.push(toMonthTransaction(row))
    detailByCategoryRole.set(key, list)
  }

  // Which categories a drawn row can actually account for, split by the role
  // that row reads. GROUP_BUDGET_ROLE is what decides it: a Receita category
  // draws its figure from INCOME rows only, so SPEND sitting on one is as
  // undrawable as spend on a category that was archived last year.
  const drawnBy = (role: 'SPEND' | 'INCOME') =>
    new Set(categories.filter((c) => GROUP_BUDGET_ROLE[c.group] === role).map((c) => c.id))
  const drawnSpendCategories = drawnBy('SPEND')
  const drawnIncomeCategories = drawnBy('INCOME')

  /**
   * The rows behind one bucket. `matches` must be the complement of what the
   * drawn rows cover for that role, because the bucket's FIGURE is a residual
   * of exactly that subtraction further down -- any row this predicate lets
   * through that the subtraction did not, or the other way round, and the
   * panel stops adding up to its own header.
   */
  const bucket = (matches: (row: (typeof detail)[number]) => boolean): MonthBucketDetail => {
    const transactions: MonthTransaction[] = []
    let transactionCount = 0
    for (const row of detail) {
      if (!matches(row)) continue
      transactionCount += 1
      if (transactions.length < DETAIL_LIMIT) transactions.push(toMonthTransaction(row))
    }
    return { transactions, transactionCount }
  }

  const uncategorizedDetail = bucket(
    (row) => row.budgetRole === 'SPEND' && row.categoryId === null,
  )
  const archivedDetail = bucket(
    (row) =>
      row.budgetRole === 'SPEND' &&
      row.categoryId !== null &&
      !drawnSpendCategories.has(row.categoryId),
  )
  const unassignedIncomeDetail = bucket(
    (row) =>
      row.budgetRole === 'INCOME' &&
      (row.categoryId === null || !drawnIncomeCategories.has(row.categoryId)),
  )
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
    const detailKey = `${category.id}:${role}`

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
            ? // Since money is filed by the month it is PAID, a later month
              // already holds real purchases: everything bought since the last
              // fatura closed is waiting there. Every figure in it is a known
              // amount, so the projection is simply what is attributed to it --
              // there is no elapsed time to extrapolate a rate from.
              actualCents
            : pace({ variableCents, committedCents, dayOfMonth: elapsedDays, daysInPeriod: daysInMonth }),
      transactions: detailByCategoryRole.get(detailKey) ?? [],
      transactionCount: countByCategoryRole.get(detailKey) ?? 0,
    }
  })

  // A category with nothing filed against it this month and no plan to hold it
  // open is a dead line -- "R$ 0,00 · sem plano" -- so it is dropped. A row
  // with a plan stays even at zero: an empty plan is the planned-vs-actual the
  // household set it up to watch, and hiding it would erase the intent.
  const visibleRows = rows.filter(
    (row) => row.transactionCount > 0 || row.plannedCents !== null,
  )

  const groups: MonthGroupView[] = CATEGORY_GROUPS.map((group) => {
    const groupRows = visibleRows.filter((row) => row.group === group)
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
    uncategorizedDetail,
    archivedDetail,
    unassignedIncomeDetail,
    plannedIncomeCents,
    plannedInvestedCents,
    plannedExpenseCents,
    netCents: incomeCents - investedCents - expenseCents,
    // Guarded rather than allowed to divide by zero: a month with no income
    // recorded yet must read as "not known", not as 0% or Infinity.
    investedShareOfIncome: incomeCents > 0 ? investedCents / incomeCents : null,
    uncategorizedSpentCents: uncategorized?.spentCents ?? 0,
    uncategorizedCount: uncategorized?.count ?? 0,
    health,
  }
}
