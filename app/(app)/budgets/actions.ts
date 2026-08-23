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

/** '1.200,50' and '1200.50' both mean the same thing to a Brazilian household. */
function parseReais(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  const normalized = trimmed.replace(/\./g, '').replace(',', '.')
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
    for (const entry of parsed) {
      if (entry.amountCents === null) {
        await clearBudget(db, session.householdId, {
          categoryId: entry.categoryId,
          period,
        })
      } else {
        await setBudget(db, session.householdId, {
          categoryId: entry.categoryId,
          period,
          amountCents: entry.amountCents,
        })
      }
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

  revalidatePath('/budgets')
  revalidatePath('/dashboard')
  revalidatePath('/forward')
  return { error: null, message: SAVED_MESSAGE }
}
