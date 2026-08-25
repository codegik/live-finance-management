'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSession } from '@/lib/auth/session'
import { clearBudget, setBudget } from '@/lib/db/budgets'
import { getDb } from '@/lib/db/client'
import { setTransactionCategory } from '@/lib/db/transactions'
import { parseReais } from '@/lib/domain/parse-reais'
import {
  INVALID_AMOUNT_ERROR,
  INVALID_PERIOD_ERROR,
  MOVED_MESSAGE,
  PLAN_CLEARED_MESSAGE,
  PLAN_SAVED_MESSAGE,
  type PlanState,
  type RecategorizeState,
  UNKNOWN_CATEGORY_ERROR,
  UNKNOWN_TRANSACTION_ERROR,
} from './state'

// Same 01..12 guard the budget editor and page use: '2026-13' is shaped like
// a period but reaches monthBounds and throws a message no catch arm here
// reads, so it would escape as a 500 instead of a form error.
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

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

/**
 * Sets (or clears) one category's plan for one month, from the dashboard row
 * where the household is already reading the number -- the same principle as
 * the inline category picker: the correction happens where the mistake is
 * visible, not on another screen.
 *
 * An empty amount is a deletion, not a zero. A budget of R$ 0,00 is the
 * editor's "spend nothing here" instruction and would fire an over-budget
 * alert on the first centavo; clearing the row instead returns it to "no
 * plan", which is what an emptied field means.
 */
export async function setCategoryBudgetAction(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const session = await requireSession()

  const period = String(formData.get('period') ?? '')
  const categoryId = String(formData.get('categoryId') ?? '')
  if (!PERIOD.test(period)) return { error: INVALID_PERIOD_ERROR, message: null }
  if (!id.safeParse(categoryId).success) {
    return { error: UNKNOWN_CATEGORY_ERROR, message: null }
  }

  let amountCents: number | null
  try {
    amountCents = parseReais(String(formData.get('amount') ?? ''))
  } catch {
    return { error: INVALID_AMOUNT_ERROR, message: null }
  }

  try {
    if (amountCents === null) {
      await clearBudget(getDb(), session.householdId, { categoryId, period })
    } else {
      await setBudget(getDb(), session.householdId, { categoryId, period, amountCents })
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'UNKNOWN_CATEGORY') {
      return { error: UNKNOWN_CATEGORY_ERROR, message: null }
    }
    if (error instanceof Error && error.message.startsWith('INVALID_AMOUNT')) {
      return { error: INVALID_AMOUNT_ERROR, message: null }
    }
    throw error
  }

  // Every screen that reads a plan just changed.
  revalidatePath('/dashboard')
  revalidatePath('/budgets')
  revalidatePath('/year')

  return {
    error: null,
    message: amountCents === null ? PLAN_CLEARED_MESSAGE : PLAN_SAVED_MESSAGE,
  }
}
