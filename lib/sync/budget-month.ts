import { eq, inArray } from 'drizzle-orm'
import type { Executor } from '@/lib/db/client'
import { accounts, connections, transactions } from '@/lib/db/schema'
import { billingMonthStart, resolveBillingDays } from '@/lib/domain/billing'

/**
 * Brings `budget_month` into line with the account's billing cycle.
 *
 * The household budgets in the month the money leaves, not the month the
 * purchase happened: a card bought on the 10th of August is paid on the fatura
 * due the 17th of September. Bucketing by `date` made every month disagree with
 * the card statement, which is the disagreement this pass removes.
 *
 * A pass rather than something computed at ingest, for the same reason
 * refreshBudgetRoles is one: the closing day lives on the ACCOUNT and the
 * household can change it in Conexões at any time. Editing it has to re-file
 * three years of history, and only a pass over stored rows can do that. It is
 * also what lets a card whose closing day was never known start shifting the
 * moment one is entered.
 *
 * Runs after refreshInstallments, and the order IS load-bearing: the rule
 * turns on `installment_number`, because instalments 2..N arrive already dated
 * by the fatura they belong to. Run first, every parcela would be shifted a
 * second time and land a month late.
 */
export async function refreshBudgetMonths(
  exec: Executor,
  householdId: string,
): Promise<{ changed: number }> {
  const rows = await exec
    .select({
      id: transactions.id,
      date: transactions.date,
      installmentNumber: transactions.installmentNumber,
      budgetMonth: transactions.budgetMonth,
      accountType: accounts.type,
      dueDay: accounts.dueDay,
      closingDay: accounts.closingDay,
      dueDayOverride: accounts.dueDayOverride,
      closingDayOverride: accounts.closingDayOverride,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(eq(connections.householdId, householdId))

  // Grouped by target month so one UPDATE covers every row that moves to it,
  // rather than one statement per transaction across a three-year history.
  const byMonth = new Map<string, string[]>()
  for (const row of rows) {
    const { dueDay, closingDay } = resolveBillingDays(row)
    const month = billingMonthStart({
      date: row.date,
      accountType: row.accountType,
      closingDay,
      dueDay,
      installmentNumber: row.installmentNumber,
    })
    // Only rows whose stored value is actually wrong, so a nightly no-op costs
    // no writes and the returned count is honest.
    if (row.budgetMonth === month) continue
    byMonth.set(month, [...(byMonth.get(month) ?? []), row.id])
  }

  let changed = 0
  for (const [month, ids] of byMonth) {
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500)
      await exec
        .update(transactions)
        .set({ budgetMonth: month, updatedAt: new Date() })
        .where(inArray(transactions.id, slice))
      changed += slice.length
    }
  }

  return { changed }
}
