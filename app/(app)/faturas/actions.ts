'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { clearFaturaOverride, setFaturaOverride } from '@/lib/db/fatura-overrides'
import {
  idSchema,
  INVALID_AMOUNT_ERROR,
  OVERRIDE_CLEARED_MESSAGE,
  OVERRIDE_SAVED_MESSAGE,
  type OverrideState,
  parseBrlToCents,
  periodSchema,
  UNKNOWN_ACCOUNT_ERROR,
} from './state'

/** Every money screen reflects the informed fatura, so all of them drop from cache. */
function revalidateMoneyScreens() {
  revalidatePath('/faturas')
  revalidatePath('/dashboard')
  revalidatePath('/year')
}

export async function setFaturaOverrideAction(
  _prev: OverrideState,
  formData: FormData,
): Promise<OverrideState> {
  const session = await requireSession()
  const accountId = String(formData.get('accountId') ?? '')
  const period = String(formData.get('period') ?? '')
  // The same shape guards the connections actions use: a hand-edited id or
  // period must read as "unknown", not 500 the request in the db layer.
  if (!idSchema.safeParse(accountId).success || !periodSchema.safeParse(period).success) {
    return { error: UNKNOWN_ACCOUNT_ERROR, message: null }
  }

  const cents = parseBrlToCents(String(formData.get('amount') ?? ''))
  if (cents === null) return { error: INVALID_AMOUNT_ERROR, message: null }

  const { ok } = await setFaturaOverride(
    getDb(),
    session.householdId,
    accountId,
    `${period}-01`,
    cents,
  )
  if (!ok) return { error: UNKNOWN_ACCOUNT_ERROR, message: null }

  revalidateMoneyScreens()
  return { error: null, message: OVERRIDE_SAVED_MESSAGE }
}

export async function clearFaturaOverrideAction(
  _prev: OverrideState,
  formData: FormData,
): Promise<OverrideState> {
  const session = await requireSession()
  const accountId = String(formData.get('accountId') ?? '')
  const period = String(formData.get('period') ?? '')
  if (!idSchema.safeParse(accountId).success || !periodSchema.safeParse(period).success) {
    return { error: UNKNOWN_ACCOUNT_ERROR, message: null }
  }

  const { ok } = await clearFaturaOverride(
    getDb(),
    session.householdId,
    accountId,
    `${period}-01`,
  )
  if (!ok) return { error: UNKNOWN_ACCOUNT_ERROR, message: null }

  revalidateMoneyScreens()
  return { error: null, message: OVERRIDE_CLEARED_MESSAGE }
}
