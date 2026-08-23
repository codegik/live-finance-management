'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { deleteConnection, setAccountDays } from '@/lib/db/connections'
import { SAVED_MESSAGE } from '../categories/state'
import {
  type ConnectionState,
  idSchema,
  INVALID_DAY_ERROR,
  REMOVED_MESSAGE,
  UNKNOWN_ACCOUNT_ERROR,
  UNKNOWN_CONNECTION_ERROR,
} from './state'

export async function removeConnectionAction(
  _prev: ConnectionState,
  formData: FormData,
): Promise<ConnectionState> {
  const session = await requireSession()
  const connectionId = String(formData.get('connectionId') ?? '')
  // A malformed id (hand-edited form, stale client) must read as "doesn't
  // exist" rather than crash the eq(uuid, ...) below with Postgres 22P02.
  if (!idSchema.safeParse(connectionId).success) {
    return { error: UNKNOWN_CONNECTION_ERROR, message: null }
  }

  // A connection id belonging to another household deletes nothing, and is
  // reported as gone rather than as forbidden -- from this session's point of
  // view it does not exist.
  const { removed } = await deleteConnection(getDb(), session.householdId, connectionId)
  if (!removed) return { error: UNKNOWN_CONNECTION_ERROR, message: null }

  revalidatePath('/settings/connections')
  revalidatePath('/dashboard')
  revalidatePath('/ledger')
  return { error: null, message: REMOVED_MESSAGE }
}

function parseDay(raw: FormDataEntryValue | null): number | null | 'INVALID' {
  const value = String(raw ?? '').trim()
  if (!value) return null
  const day = Number(value)
  // 31 is allowed even in a 30-day month: it means "the last day it can be",
  // and this is invoice context, not a date the system computes with.
  if (!Number.isInteger(day) || day < 1 || day > 31) return 'INVALID'
  return day
}

export async function saveAccountDaysAction(
  _prev: ConnectionState,
  formData: FormData,
): Promise<ConnectionState> {
  const session = await requireSession()
  const accountId = String(formData.get('accountId') ?? '')
  // Same 22P02 hazard as removeConnectionAction: reject a non-UUID shape
  // before it reaches eq(accounts.id, accountId) in setAccountDays.
  if (!idSchema.safeParse(accountId).success) {
    return { error: UNKNOWN_ACCOUNT_ERROR, message: null }
  }

  const dueDay = parseDay(formData.get('dueDay'))
  const closingDay = parseDay(formData.get('closingDay'))
  if (dueDay === 'INVALID' || closingDay === 'INVALID') {
    return { error: INVALID_DAY_ERROR, message: null }
  }

  const { updated } = await setAccountDays(getDb(), session.householdId, accountId, {
    dueDay,
    closingDay,
  })
  if (!updated) return { error: UNKNOWN_ACCOUNT_ERROR, message: null }

  revalidatePath('/settings/connections')
  return { error: null, message: SAVED_MESSAGE }
}
