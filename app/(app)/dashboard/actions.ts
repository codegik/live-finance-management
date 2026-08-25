'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { setTransactionCategory } from '@/lib/db/transactions'
import {
  MOVED_MESSAGE,
  type RecategorizeState,
  UNKNOWN_CATEGORY_ERROR,
  UNKNOWN_TRANSACTION_ERROR,
} from './state'

// Postgres throws 22P02 -- not an empty result -- when a non-UUID string
// reaches eq(<uuid column>, value), so the shape is checked before either id
// reaches the query.
const id = z.string().uuid()

/**
 * Moves one transaction to another category, from wherever it is being read.
 *
 * The correction is stored as MANUAL, which is what makes it stick:
 * recategorize() excludes MANUAL rows in its query predicate, so the nightly
 * pass will not put the row back where Pluggy's mapping says it belongs. A
 * correction that silently reverts overnight is worse than no correction at
 * all -- the household stops trusting the screen rather than the mapping.
 *
 * Deliberately one row, and deliberately no rule. "Always categorize this
 * merchant" is the inbox's job and creates a merchant_rule; this is the other
 * case, where a single charge landed somewhere odd and only that charge is
 * wrong.
 */
export async function setTransactionCategoryAction(
  _prev: RecategorizeState,
  formData: FormData,
): Promise<RecategorizeState> {
  const session = await requireSession()

  const transactionId = String(formData.get('transactionId') ?? '')
  const categoryId = String(formData.get('categoryId') ?? '')
  if (!id.safeParse(transactionId).success) {
    return { error: UNKNOWN_TRANSACTION_ERROR, message: null }
  }
  if (!id.safeParse(categoryId).success) {
    return { error: UNKNOWN_CATEGORY_ERROR, message: null }
  }

  try {
    await setTransactionCategory(getDb(), session.householdId, transactionId, categoryId)
  } catch (error) {
    // A category from another household is an ordinary user error here, not a
    // server fault: report it as form state. Anything else is a real failure
    // and still surfaces as one.
    if (error instanceof Error && error.message === 'UNKNOWN_CATEGORY') {
      return { error: UNKNOWN_CATEGORY_ERROR, message: null }
    }
    throw error
  }

  // Every screen that totals money by category just changed.
  revalidatePath('/dashboard')
  revalidatePath('/year')
  revalidatePath('/ledger')
  revalidatePath('/inbox')

  return { error: null, message: MOVED_MESSAGE }
}
