import { and, inArray, isNull, ne, notInArray, or, type SQL } from 'drizzle-orm'
import type { Executor } from '@/lib/db/client'
import { householdTransactionIds } from '@/lib/db/transactions'
import { transactions } from '@/lib/db/schema'
import {
  type BudgetRole,
  INCOME_PLUGGY_CATEGORIES,
  TRANSFER_PLUGGY_CATEGORIES,
} from '@/lib/domain/budget-role'

/**
 * Brings `budget_role` into line with the household's transactions.
 *
 * This is deliberately NOT part of recategorize. That function excludes
 * MANUAL rows in its query predicate -- the guarantee Slice 2 exists to make
 * -- but whether a row is an invoice payment or a salary has nothing to do
 * with who set its category. A hand-categorized invoice payment must still be
 * excluded, so this pass has no MANUAL exclusion at all.
 *
 * It also moves rows back: a row whose category stopped being an exclusion
 * becomes spending again. That is what makes it safe to run nightly rather
 * than once, and what lets an extended category list land without a
 * migration.
 */
export async function refreshBudgetRoles(
  exec: Executor,
  householdId: string,
): Promise<{ changed: number }> {
  const transfer = [...TRANSFER_PLUGGY_CATEGORIES]
  const income = [...INCOME_PLUGGY_CATEGORIES]
  const excluded = [...transfer, ...income]

  async function setRole(role: BudgetRole, match: SQL | undefined) {
    const rows = await exec
      .update(transactions)
      .set({ budgetRole: role, updatedAt: new Date() })
      .where(
        and(
          inArray(transactions.id, householdTransactionIds(exec, householdId)),
          // Only rows whose role is actually wrong, so a nightly no-op costs
          // no writes and the returned count is honest.
          ne(transactions.budgetRole, role),
          match,
        ),
      )
      .returning({ id: transactions.id })
    return rows.length
  }

  const flaggedTransfer = await setRole('TRANSFER', inArray(transactions.pluggyCategory, transfer))
  const flaggedIncome = await setRole('INCOME', inArray(transactions.pluggyCategory, income))
  // A NULL category is spending, and `NOT (null IN (...))` is NULL rather
  // than true -- so it needs saying explicitly.
  const flaggedSpend = await setRole(
    'SPEND',
    or(isNull(transactions.pluggyCategory), notInArray(transactions.pluggyCategory, excluded)),
  )

  return { changed: flaggedTransfer + flaggedIncome + flaggedSpend }
}
