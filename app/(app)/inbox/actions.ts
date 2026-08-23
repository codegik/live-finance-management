'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { createRule } from '@/lib/db/rules'
import { setCategoryForMerchant } from '@/lib/db/transactions'
import {
  ASSIGNED_MESSAGE,
  DUPLICATE_RULE_ERROR,
  EMPTY_PATTERN_ERROR,
  MISSING_FIELD_ERROR,
  type AssignState,
  UNKNOWN_CATEGORY_ERROR,
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
      // to nothing once createRule normalizes it. A forged categoryId that
      // does not belong to this household is the same kind of ordinary user
      // error, not a server fault -- report both as form state. Anything
      // else still surfaces as a 500, which is what it is.
      if (error instanceof Error && error.message === 'EMPTY_PATTERN') {
        return { error: EMPTY_PATTERN_ERROR, message: null }
      }
      if (error instanceof Error && error.message === 'UNKNOWN_CATEGORY') {
        return { error: UNKNOWN_CATEGORY_ERROR, message: null }
      }
      // Two merchant groups edited down to the same pattern -- 'ZAFFARI
      // PORTO ALEG' and 'ZAFFARI CENTRO' both shortened to CONTAINS ZAFFARI
      // -- collide on merchant_rule_unique. postgres.js surfaces that as a
      // PostgresError carrying a Postgres error code, not a distinguishable
      // message; narrow on the code, which is stable, not on message text,
      // which is not.
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        return { error: DUPLICATE_RULE_ERROR, message: null }
      }
      throw error
    }
  }

  try {
    const { changed } = await setCategoryForMerchant(db, session.householdId, merchant, categoryId)
    revalidatePath('/inbox')
    revalidatePath('/ledger')
    return { error: null, message: `${ASSIGNED_MESSAGE} — ${changed} transactions moved.` }
  } catch (error) {
    if (error instanceof Error && error.message === 'UNKNOWN_CATEGORY') {
      return { error: UNKNOWN_CATEGORY_ERROR, message: null }
    }
    throw error
  }
}
