'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { createRule } from '@/lib/db/rules'
import { setCategoryForMerchant } from '@/lib/db/transactions'
import { ASSIGNED_MESSAGE, MISSING_FIELD_ERROR, type AssignState } from './state'

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
    const { changed } = await createRule(db, session.householdId, {
      matchType,
      pattern,
      categoryId,
    })
    revalidatePath('/inbox')
    revalidatePath('/ledger')
    return { error: null, message: `${ASSIGNED_MESSAGE} — ${changed} transactions moved.` }
  }

  const { changed } = await setCategoryForMerchant(db, session.householdId, merchant, categoryId)
  revalidatePath('/inbox')
  revalidatePath('/ledger')
  return { error: null, message: `${ASSIGNED_MESSAGE} — ${changed} transactions moved.` }
}
