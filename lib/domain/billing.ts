/**
 * Which month a transaction is paid in -- the month the household actually
 * parts with the money, which is the month it budgets in.
 *
 * A card purchase made on the 10th of August is not an August expense to the
 * household that pays it: it lands on the fatura closing in early September
 * and leaves the account on the 17th. Bucketing it in August is what made the
 * app disagree with the card statement on every single month.
 *
 * There is deliberately no timezone handling here. `transaction.date` was
 * bucketed to America/Sao_Paulo once, at ingest, so this is plain calendar
 * arithmetic on a `YYYY-MM-DD` string -- the same reasoning as
 * lib/domain/budget.ts.
 */

/** A `YYYY-MM` period. */
function periodOf(date: string): string {
  return date.slice(0, 7)
}

function dayOf(date: string): number {
  return Number(date.slice(8, 10))
}

function addMonthsToPeriod(period: string, months: number): string {
  const year = Number(period.slice(0, 4))
  const month = Number(period.slice(5, 7))
  const zeroBased = year * 12 + (month - 1) + months
  return `${String(Math.floor(zeroBased / 12)).padStart(4, '0')}-${String(
    (zeroBased % 12) + 1,
  ).padStart(2, '0')}`
}

export type BillingInput = {
  /** The transaction's own calendar date, `YYYY-MM-DD`. */
  date: string
  accountType: 'CREDIT' | 'BANK'
  /** The household override if set, otherwise the connector's value. */
  closingDay: number | null
  dueDay: number | null
  /** 1 for the purchase itself, 2+ for a later instalment, null for neither. */
  installmentNumber: number | null
}

/**
 * The `YYYY-MM` this transaction is paid in.
 *
 * Four cases, and three of them are "leave it where it is":
 *
 *   BANK — a PIX, a TED, a salary. It settles the day it happens; there is no
 *   bill and nothing to shift.
 *
 *   CREDIT with no closing day — nothing to compute a cycle from. Falls back
 *   to the transaction's own month rather than guessing a cycle, because a
 *   guessed cycle silently moves money into the wrong month and looks exactly
 *   like a correct answer. Set the closing day in Conexões and it starts
 *   shifting.
 *
 *   CREDIT, instalment 2 or later — VERIFIED AGAINST REAL DATA: on a live
 *   Itau card, instalment 1 falls on every day of the month (a real purchase
 *   date) while instalments 2..N sit on the 15th, 33 of them, spilling to the
 *   16th–18th when the 15th is a weekend. The connector already dates these by
 *   the fatura they belong to, so shifting them again would push every parcela
 *   a month late.
 *
 *   CREDIT, everything else — a real purchase date, so it moves to the month
 *   of the bill it lands on.
 */
export function billingPeriod(input: BillingInput): string {
  const own = periodOf(input.date)

  if (input.accountType !== 'CREDIT') return own
  if (input.closingDay === null) return own
  // The connector has already assigned this one to a fatura.
  if (input.installmentNumber !== null && input.installmentNumber >= 2) return own

  // A purchase on or before the closing day is on the bill closing THIS
  // month; after it, on next month's.
  const closingPeriod = dayOf(input.date) <= input.closingDay ? own : addMonthsToPeriod(own, 1)

  // The bill closing on the 5th and due on the 17th is paid the same month.
  // A card that closes on the 25th and falls due on the 5th is paid the next
  // one, and that is the month the money leaves.
  const dueDay = input.dueDay ?? input.closingDay
  return dueDay > input.closingDay ? closingPeriod : addMonthsToPeriod(closingPeriod, 1)
}

/** First of the billing month, as stored in `transaction.budget_month`. */
export function billingMonthStart(input: BillingInput): string {
  return `${billingPeriod(input)}-01`
}

/**
 * The household's value wins over the connector's.
 *
 * Pluggy left `closing_day` null on a live Itau card while happily supplying
 * `due_day`, so the override is not an edge case -- it is the only source of
 * a closing day this household has.
 */
export function resolveBillingDays(account: {
  dueDay: number | null
  closingDay: number | null
  dueDayOverride: number | null
  closingDayOverride: number | null
}): { dueDay: number | null; closingDay: number | null } {
  return {
    dueDay: account.dueDayOverride ?? account.dueDay,
    closingDay: account.closingDayOverride ?? account.closingDay,
  }
}
