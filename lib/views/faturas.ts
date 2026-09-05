import { and, eq, inArray, sql } from 'drizzle-orm'
import { budgetPeriodSql } from '@/lib/db/budget-month-sql'
import type { Db } from '@/lib/db/client'
import { listFaturaOverrides } from '@/lib/db/fatura-overrides'
import { accounts, bills, connections, transactions } from '@/lib/db/schema'
import { saoPauloPeriod } from '@/lib/domain/dates'

/**
 * One fatura for a card, in one of three flavours, in priority order:
 *   BILL     -- the bank's own closed statement, authoritative to the centavo.
 *   OVERRIDE -- a total the household typed for an open cycle the bank has not
 *               published yet. Provisional but deliberate; yields to a BILL the
 *               moment one lands for the same period.
 *   ESTIMATE -- no bill and no override: summed from transactions, and therefore
 *               low until the fatura closes (it lacks interest, IOF, fees, and
 *               the authorizations the bank has not shared yet).
 */
export type FaturaRow = {
  period: string
  source: 'BILL' | 'OVERRIDE' | 'ESTIMATE'
  amountCents: number
  /** The transaction sum for the cycle. On an OVERRIDE row this is what the
   *  household's figure is being compared against; null on a BILL. */
  estimateCents: number | null
  dueDate: string | null
  closingDate: string | null
  minimumCents: number | null
}

export type FaturaCard = {
  accountId: string
  name: string
  last4: string | null
  institution: string
  rows: FaturaRow[]
}

export type FaturasView = {
  currentPeriod: string
  cards: FaturaCard[]
}

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

/** Credit accounts of a household, with the bank label. */
async function creditAccountsOf(db: Db, householdId: string) {
  return db
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
}

/** Bills and transaction estimates for a set of accounts, keyed `accountId:YYYY-MM`. */
async function billsAndEstimates(db: Db, accountIds: string[]) {
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
  const estimateByKey = new Map(estimateRows.map((e) => [`${e.accountId}:${e.period}`, e.amountCents]))
  return { billRows, estimateRows, billByKey, estimateByKey }
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

  const creditAccounts = await creditAccountsOf(db, householdId)
  if (creditAccounts.length === 0) return { currentPeriod, cards: [] }
  const accountIds = creditAccounts.map((a) => a.id)

  const [{ billRows, estimateRows, billByKey, estimateByKey }, overrides] = await Promise.all([
    billsAndEstimates(db, accountIds),
    listFaturaOverrides(db, householdId),
  ])

  const cards: FaturaCard[] = creditAccounts.map((account) => {
    const periods = new Set<string>()
    for (const b of billRows) if (b.accountId === account.id && inWindow(b.period)) periods.add(b.period)
    for (const e of estimateRows)
      if (e.accountId === account.id && inWindow(e.period)) periods.add(e.period)
    // An override for a period with no transactions yet still deserves a row.
    for (const key of overrides.keys()) {
      const [accId, period] = key.split(':')
      if (accId === account.id && inWindow(period)) periods.add(period)
    }

    const rows: FaturaRow[] = [...periods]
      .sort((a, b) => (a < b ? 1 : -1))
      .map((period) => {
        const key = `${account.id}:${period}`
        const estimate = estimateByKey.get(key) ?? 0
        const bill = billByKey.get(key)
        // Bill wins over everything: it is the bank's own number.
        if (bill) {
          return {
            period,
            source: 'BILL' as const,
            amountCents: bill.totalAmountCents,
            estimateCents: null,
            dueDate: bill.dueDate,
            closingDate: bill.closingDate,
            minimumCents: bill.minimumAmountCents,
          }
        }
        const override = overrides.get(key)
        if (override != null) {
          return {
            period,
            source: 'OVERRIDE' as const,
            amountCents: override,
            estimateCents: estimate,
            dueDate: null,
            closingDate: null,
            minimumCents: null,
          }
        }
        return {
          period,
          source: 'ESTIMATE' as const,
          amountCents: estimate,
          estimateCents: estimate,
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

/**
 * One line per card whose OPEN fatura the household has overridden above what
 * the transactions show, for a single period -- the "spend on the way" the
 * dashboard surfaces. Skips a card whose bill has since landed (the bill is
 * authoritative and the override no longer applies) and any override at or below
 * the synced total (nothing is "on the way").
 */
export type PendingFaturaLine = {
  accountId: string
  label: string
  overrideCents: number
  estimateCents: number
  diffCents: number
}

export async function getPendingFaturaLines(
  db: Db,
  householdId: string,
  period: string,
): Promise<PendingFaturaLine[]> {
  const creditAccounts = await creditAccountsOf(db, householdId)
  if (creditAccounts.length === 0) return []
  const accountIds = creditAccounts.map((a) => a.id)

  const [{ billByKey, estimateByKey }, overrides] = await Promise.all([
    billsAndEstimates(db, accountIds),
    listFaturaOverrides(db, householdId),
  ])

  const lines: PendingFaturaLine[] = []
  for (const account of creditAccounts) {
    const key = `${account.id}:${period}`
    const override = overrides.get(key)
    if (override == null) continue
    // A published bill supersedes the override entirely.
    if (billByKey.get(key)) continue
    const estimate = estimateByKey.get(key) ?? 0
    const diff = override - estimate
    if (diff <= 0) continue
    lines.push({
      accountId: account.id,
      label: account.last4 ? `${account.name} ···· ${account.last4}` : account.name,
      overrideCents: override,
      estimateCents: estimate,
      diffCents: diff,
    })
  }
  return lines
}
