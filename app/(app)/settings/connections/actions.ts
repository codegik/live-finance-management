'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { deleteConnection } from '@/lib/db/connections'
import { type ConnectionState, REMOVED_MESSAGE, UNKNOWN_CONNECTION_ERROR } from './state'

export async function removeConnectionAction(
  _prev: ConnectionState,
  formData: FormData,
): Promise<ConnectionState> {
  const session = await requireSession()
  const connectionId = String(formData.get('connectionId') ?? '')
  if (!connectionId) return { error: UNKNOWN_CONNECTION_ERROR, message: null }

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
