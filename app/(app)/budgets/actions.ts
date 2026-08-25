'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { clearBudget, setBudget } from '@/lib/db/budgets'
import { getDb } from '@/lib/db/client'
import { parseReais } from '@/lib/domain/parse-reais'
import {
  INVALID_AMOUNT_ERROR,
  INVALID_PERIOD_ERROR,
  SAVED_MESSAGE,
  UNKNOWN_CATEGORY_ERROR,
  type BudgetState,
} from './state'

// The month half has to be 01..12, not any two digits: '2026-13' passes a
// looser shape check, reaches monthBounds, and throws INVALID_PERIOD:2026-13 --
// a message matching neither catch arm below, so it escapes as the very 500
// this guard exists to prevent.
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
// Postgres rejects a non-UUID string cast to uuid with an error that matches
// neither catch arm below, so it has to be caught before it reaches the query.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function saveBudgetsAction(
  _prev: BudgetState,
  formData: FormData,
): Promise<BudgetState> {
  const session = await requireSession()
  const period = String(formData.get('period') ?? '')

  // Validate the shape of both keys up front. Without this a malformed
  // period reaches monthBounds, which throws INVALID_PERIOD:… -- a message
  // matching neither catch arm below, so it escapes as a 500 instead of a
  // form error the household can read and act on.
  if (!PERIOD.test(period)) return { error: INVALID_PERIOD_ERROR, message: null }

  // Parse everything before writing anything: a half-saved budget screen is
  // worse than a rejected one, because the household cannot see which half.
  const parsed: { categoryId: string; amountCents: number | null }[] = []
  try {
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith('amount:')) continue
      const categoryId = key.slice('amount:'.length)
      // Not an authorization check -- setBudget still proves the category
      // belongs to this household. This only keeps a value that could never
      // be a uuid from reaching Postgres as a cast error.
      if (!UUID.test(categoryId)) return { error: UNKNOWN_CATEGORY_ERROR, message: null }
      parsed.push({ categoryId, amountCents: parseReais(String(value)) })
    }
  } catch {
    return { error: INVALID_AMOUNT_ERROR, message: null }
  }

  const db = getDb()
  try {
    // The writes must be as atomic as the parse: one transaction, so a
    // rejected category id partway through the form leaves nothing written
    // rather than saving everything before it.
    await db.transaction(async (tx) => {
      for (const entry of parsed) {
        if (entry.amountCents === null) {
          await clearBudget(tx, session.householdId, {
            categoryId: entry.categoryId,
            period,
          })
        } else {
          await setBudget(tx, session.householdId, {
            categoryId: entry.categoryId,
            period,
            amountCents: entry.amountCents,
          })
        }
      }
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNKNOWN_CATEGORY') {
      return { error: UNKNOWN_CATEGORY_ERROR, message: null }
    }
    if (error instanceof Error && error.message.startsWith('INVALID_AMOUNT')) {
      return { error: INVALID_AMOUNT_ERROR, message: null }
    }
    throw error
  }

  revalidatePath('/budgets')
  revalidatePath('/dashboard')
  revalidatePath('/year')
  return { error: null, message: SAVED_MESSAGE }
}
