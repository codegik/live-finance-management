import { and, eq, inArray, sql } from 'drizzle-orm'
import { budgetPeriodSql } from '@/lib/db/budget-month-sql'
import type { Db } from '@/lib/db/client'
import { accounts, bills, connections, transactions } from '@/lib/db/schema'
import { saoPauloPeriod } from '@/lib/domain/dates'

/**
 * One fatura for a card, in one of two flavours:
 *   BILL     -- the bank's own closed statement, authoritative to the centavo.
 *   ESTIMATE -- a cycle with no bill yet (the open one, or a future
 *               installment projection), summed from transactions and therefore
 *               provisional: it lacks interest, IOF and fees, and its cycle
 *               boundary is a guess until the bank publishes the real bill.
 */
export type FaturaRow = {
  /** `YYYY-MM`, the month the fatura is paid. */
  period: string
  source: 'BILL' | 'ESTIMATE'
  amountCents: number
  dueDate: string | null
  closingDate: string | null
  minimumCents: number | null
}

export type FaturaCard = {
  accountId: string
  name: string
  last4: string | null
  institution: string
  /** Newest first. */
  rows: FaturaRow[]
}

export type FaturasView = {
  currentPeriod: string
  cards: FaturaCard[]
}

/** Periods shown per card: three months back through one ahead of today. Far
 *  future installment projections are real but not "a fatura to pay", so the
 *  window keeps this to the cycles a household actually acts on. */
const MONTHS_BACK = 3
const MONTHS_FORWARD = 1

function shiftPeriod(period: string, months: number): string {
  const year = Number(period.slice(0, 4))
  const month = Number(period.slice(5, 7))
  const zeroBased = year * 12 + (month - 1) + months
  return `${String(Math.floor(zeroBased / 12)).padStart(4, '0')}-${String(
    (zeroBased % 12) + 1,
  ).padStart(2, '0')}`
}

export async function getFaturasView(
  db: Db,
  householdId: string,
  opts: { now?: Date } = {},
): Promise<FaturasView> {
  const now = opts.now ?? new Date()
  const currentPeriod = saoPauloPeriod(now)
  const from = shiftPeriod(currentPeriod, -MONTHS_BACK)
  const to = shiftPeriod(currentPeriod, MONTHS_FORWARD)
  const inWindow = (period: string) => period >= from && period <= to

  const creditAccounts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      last4: accounts.last4,
      institution: connections.institution,
    })
    .from(accounts)
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(and(eq(connections.householdId, householdId), eq(accounts.type, 'CREDIT')))
    .orderBy(accounts.name)

  if (creditAccounts.length === 0) return { currentPeriod, cards: [] }
  const accountIds = creditAccounts.map((a) => a.id)

  // Authoritative bills, and the per-cycle transaction estimate, in parallel.
  const [billRows, estimateRows] = await Promise.all([
    db
      .select({
        accountId: bills.accountId,
        period: sql<string>`to_char(${bills.period}, 'YYYY-MM')`,
        dueDate: bills.dueDate,
        closingDate: bills.closingDate,
        totalAmountCents: bills.totalAmountCents,
        minimumAmountCents: bills.minimumAmountCents,
      })
      .from(bills)
      .where(inArray(bills.accountId, accountIds)),
    db
      .select({
        accountId: transactions.accountId,
        period: budgetPeriodSql,
        // SPEND only, net of refunds -- the same basis the dashboard totals a
        // card on, so an estimate here matches what Despesas shows for it.
        amountCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::bigint`.mapWith(
          Number,
        ),
      })
      .from(transactions)
      .where(and(inArray(transactions.accountId, accountIds), eq(transactions.budgetRole, 'SPEND')))
      .groupBy(transactions.accountId, budgetPeriodSql),
  ])

  const billByKey = new Map(billRows.map((b) => [`${b.accountId}:${b.period}`, b]))
  const estimateByKey = new Map(estimateRows.map((e) => [`${e.accountId}:${e.period}`, e]))

  const cards: FaturaCard[] = creditAccounts.map((account) => {
    // Every period this card has either a bill or spend in, within the window.
    const periods = new Set<string>()
    for (const b of billRows) if (b.accountId === account.id && inWindow(b.period)) periods.add(b.period)
    for (const e of estimateRows)
      if (e.accountId === account.id && inWindow(e.period)) periods.add(e.period)

    const rows: FaturaRow[] = [...periods]
      .sort((a, b) => (a < b ? 1 : -1))
      .map((period) => {
        const bill = billByKey.get(`${account.id}:${period}`)
        if (bill) {
          return {
            period,
            source: 'BILL' as const,
            amountCents: bill.totalAmountCents,
            dueDate: bill.dueDate,
            closingDate: bill.closingDate,
            minimumCents: bill.minimumAmountCents,
          }
        }
        return {
          period,
          source: 'ESTIMATE' as const,
          amountCents: estimateByKey.get(`${account.id}:${period}`)?.amountCents ?? 0,
          dueDate: null,
          closingDate: null,
          minimumCents: null,
        }
      })

    return {
      accountId: account.id,
      name: account.name,
      last4: account.last4,
      institution: account.institution,
      rows,
    }
  })

  return { currentPeriod, cards }
}
