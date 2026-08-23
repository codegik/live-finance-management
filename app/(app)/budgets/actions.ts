'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { clearBudget, setBudget } from '@/lib/db/budgets'
import { getDb } from '@/lib/db/client'
import {
  INVALID_AMOUNT_ERROR,
  SAVED_MESSAGE,
  UNKNOWN_CATEGORY_ERROR,
  type BudgetState,
} from './state'

/**
 * A Brazilian household writes '1.200,50'; a keyboard often produces
 * '1200.50'. Both must mean the same amount.
 *
 * When a comma is present it is the decimal separator and every dot is a
 * thousands separator. With no comma, a lone dot is ambiguous -- '1.200' is
 * one thousand two hundred, '1200.50' is twelve hundred and fifty centavos.
 * A dot followed by exactly three digits is a thousands separator; anything
 * else is a decimal point. That is the rule Brazilian formatting actually
 * follows, and getting it wrong overstates a budget by 100x.
 */
function parseReais(raw: string): number | null {
  const trimmed = raw.trim().replace(/^R\$\s*/i, '')
  if (trimmed === '') return null

  let normalized: string
  if (trimmed.includes(',')) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.')
  } else if (/\.\d{3}$/.test(trimmed) || /\.\d{3}\./.test(trimmed)) {
    normalized = trimmed.replace(/\./g, '')
  } else {
    normalized = trimmed
  }

  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) throw new Error('INVALID_AMOUNT')

  return Math.round(value * 100)
}

export async function saveBudgetsAction(
  _prev: BudgetState,
  formData: FormData,
): Promise<BudgetState> {
  const session = await requireSession()
  const period = String(formData.get('period') ?? '')

  // Parse everything before writing anything: a half-saved budget screen is
  // worse than a rejected one, because the household cannot see which half.
  const parsed: { categoryId: string; amountCents: number | null }[] = []
  try {
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith('amount:')) continue
      parsed.push({
        categoryId: key.slice('amount:'.length),
        amountCents: parseReais(String(value)),
      })
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
  revalidatePath('/forward')
  return { error: null, message: SAVED_MESSAGE }
}
