'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { deleteConnection, listConnections, setAccountDays } from '@/lib/db/connections'
import { createMailer } from '@/lib/email/resend'
import { loadEnv } from '@/lib/env'
import { createPluggyClient } from '@/lib/pluggy/client'
import { refreshBudgetMonths } from '@/lib/sync/budget-month'
import { reconcileConnection } from '@/lib/sync/reconcile'
import { SAVED_MESSAGE } from '../categories/state'
import {
  type ConnectionState,
  idSchema,
  INVALID_DAY_ERROR,
  REFRESH_FAILED_ERROR,
  REFRESH_THROTTLED_MESSAGE,
  REFRESHED_MESSAGE,
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

/** Says what the save actually did, so a re-filed history is visible. */
function refiledMessage(changed: number): string {
  return changed === 1
    ? 'Salvo. 1 lançamento foi remanejado para outro mês.'
    : `Salvo. ${changed} lançamentos foram remanejados para outro mês.`
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

  // Re-file the history immediately, rather than leaving it to the nightly
  // reconcile.
  //
  // The closing day decides which fatura a purchase lands on, and therefore
  // which month every budgeting screen counts it in. Saving a corrected day
  // and seeing the months not move is indistinguishable from the save having
  // failed -- and the household's next move is to change the day again, which
  // makes it worse. Waiting up to 24 hours for a number the user just typed to
  // take effect is not a delay, it is a screen that disagrees with itself.
  //
  // Whole-household rather than this account alone: the pass is keyed on the
  // household, every account resolves its own days inside it, and re-filing
  // rows that did not move costs nothing (it writes only rows whose stored
  // month is actually wrong).
  const { changed } = await refreshBudgetMonths(getDb(), session.householdId)

  revalidatePath('/settings/connections')
  // Every screen that counts money by month is now wrong in the cache.
  revalidatePath('/dashboard')
  revalidatePath('/year')
  revalidatePath('/budgets')

  return {
    error: null,
    message: changed > 0 ? refiledMessage(changed) : SAVED_MESSAGE,
  }
}

/**
 * The "Atualizar agora" button: ask Pluggy to re-fetch this bank now instead of
 * waiting for its automatic cadence, then re-read and re-file whatever it holds.
 *
 * The forced fetch is best-effort. Pluggy allows it only about once an hour, and
 * an MFA connector may refuse it outright; either way the sync below still runs,
 * so the button always does something -- at worst it re-reads the current data
 * and prunes any duplicates -- rather than appearing to fail.
 */
export async function refreshConnectionAction(
  _prev: ConnectionState,
  formData: FormData,
): Promise<ConnectionState> {
  const session = await requireSession()
  const connectionId = String(formData.get('connectionId') ?? '')
  if (!idSchema.safeParse(connectionId).success) {
    return { error: UNKNOWN_CONNECTION_ERROR, message: null }
  }

  // listConnections is already household-scoped, so finding the id here both
  // authorizes the request and hands us the pluggyItemId -- a connection from
  // another household simply is not in the list, and reads as gone.
  const db = getDb()
  const connection = (await listConnections(db, session.householdId)).find(
    (c) => c.id === connectionId,
  )
  if (!connection) return { error: UNKNOWN_CONNECTION_ERROR, message: null }

  const env = loadEnv()
  const pluggy = createPluggyClient({
    apiUrl: env.PLUGGY_API_URL,
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
  })
  const mailer = createMailer({ apiKey: env.RESEND_API_KEY, from: env.ALERT_EMAIL_FROM })

  // Trigger the bank fetch first, but never let its refusal abort the refresh:
  // a rate-limit or an MFA connector must still fall through to the sync.
  let throttled = false
  try {
    await pluggy.updateItem(connection.pluggyItemId)
  } catch (error) {
    throttled = true
    console.error('force update refused', { connectionId, error })
  }

  try {
    const { synced } = await reconcileConnection(db, pluggy, connectionId, { mailer })
    if (!synced) return { error: UNKNOWN_CONNECTION_ERROR, message: null }
  } catch (error) {
    // The sync itself failing (Pluggy auth down, a bad payload) is the one case
    // the button genuinely could not do anything -- say so honestly.
    console.error('refresh sync failed', { connectionId, error })
    return { error: REFRESH_FAILED_ERROR, message: null }
  }

  revalidatePath('/settings/connections')
  // The refresh may have pulled new spend, re-filed months, or pruned a
  // duplicate -- every money screen's cache is now potentially stale.
  revalidatePath('/dashboard')
  revalidatePath('/ledger')
  revalidatePath('/year')
  revalidatePath('/budgets')

  return {
    error: null,
    message: throttled ? REFRESH_THROTTLED_MESSAGE : REFRESHED_MESSAGE,
  }
}
