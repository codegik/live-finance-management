import { and, eq, inArray, isNull, notInArray, or } from 'drizzle-orm'
import type { Executor } from '@/lib/db/client'
import { householdTransactionIds } from '@/lib/db/transactions'
import { transactions } from '@/lib/db/schema'
import { TRANSFER_PLUGGY_CATEGORIES } from '@/lib/domain/transfers'

/**
 * Brings `is_transfer` into line with the household's transactions.
 *
 * This is deliberately NOT part of recategorize. That function excludes
 * MANUAL rows in its query predicate -- the guarantee Slice 2 exists to make
 * -- but whether a row is an invoice payment has nothing to do with who set
 * its category. A hand-categorized invoice payment must still be flagged, so
 * this pass has no MANUAL exclusion at all.
 *
 * It also unflags: a row whose category stopped being a transfer becomes
 * spending again. That is what makes it safe to run nightly rather than once.
 */
export async function refreshTransferFlags(
  exec: Executor,
  householdId: string,
): Promise<{ flagged: number }> {
  const categories = [...TRANSFER_PLUGGY_CATEGORIES]

  // Two explicit statements rather than one clever one. Each touches only
  // rows whose flag is actually wrong, so a nightly no-op costs no writes and
  // the returned count is honest.
  const flaggedOn = await exec
    .update(transactions)
    .set({ isTransfer: true, updatedAt: new Date() })
    .where(
      and(
        inArray(transactions.id, householdTransactionIds(exec, householdId)),
        inArray(transactions.pluggyCategory, categories),
        eq(transactions.isTransfer, false),
      ),
    )
    .returning({ id: transactions.id })

  const flaggedOff = await exec
    .update(transactions)
    .set({ isTransfer: false, updatedAt: new Date() })
    .where(
      and(
        inArray(transactions.id, householdTransactionIds(exec, householdId)),
        // A NULL category is not a transfer, and `NOT (null IN (...))` is
        // NULL rather than true -- so it needs saying explicitly.
        or(isNull(transactions.pluggyCategory), notInArray(transactions.pluggyCategory, categories)),
        eq(transactions.isTransfer, true),
      ),
    )
    .returning({ id: transactions.id })

  return { flagged: flaggedOn.length + flaggedOff.length }
}
