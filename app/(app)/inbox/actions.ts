'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { createRule } from '@/lib/db/rules'
import { setCategoryForMerchant } from '@/lib/db/transactions'
import {
  ASSIGNED_MESSAGE,
  EMPTY_PATTERN_ERROR,
  MISSING_FIELD_ERROR,
  type AssignState,
} from './state'

export async function assignGroupAction(
  _prev: AssignState,
  formData: FormData,
): Promise<AssignState> {
  const session = await requireSession()
  const db = getDb()

  const rawMerchant = String(formData.get('merchant') ?? '')
  // The "no usable merchant" group is addressed by an empty string in the
  // form and by null in the database; they must not be conflated.
  const merchant = rawMerchant === '' ? null : rawMerchant
  const categoryId = String(formData.get('categoryId') ?? '')
  const wantsRule = formData.get('createRule') === 'on'
  const pattern = String(formData.get('pattern') ?? rawMerchant)
  const matchType = formData.get('matchType') === 'CONTAINS' ? 'CONTAINS' : 'EXACT'

  if (!categoryId) return { error: MISSING_FIELD_ERROR, message: null }

  // A rule cannot be written for the group that has no merchant to match on.
  if (wantsRule && merchant !== null && pattern.trim() !== '') {
    try {
      const { changed } = await createRule(db, session.householdId, {
        matchType,
        pattern,
        categoryId,
      })
      revalidatePath('/inbox')
      revalidatePath('/ledger')
      return { error: null, message: `${ASSIGNED_MESSAGE} — ${changed} transactions moved.` }
    } catch (error) {
      // normalizeMerchant strips punctuation before checking emptiness, so a
      // pattern like '***' passes the trim() guard above but still reduces
      // to nothing once createRule normalizes it. That's ordinary user
      // error, not a server fault -- report it as form state. Anything else
      // still surfaces as a 500, which is what it is.
      if (error instanceof Error && error.message === 'EMPTY_PATTERN') {
        return { error: EMPTY_PATTERN_ERROR, message: null }
      }
      throw error
    }
  }

  const { changed } = await setCategoryForMerchant(db, session.householdId, merchant, categoryId)
  revalidatePath('/inbox')
  revalidatePath('/ledger')
  return { error: null, message: `${ASSIGNED_MESSAGE} — ${changed} transactions moved.` }
}
