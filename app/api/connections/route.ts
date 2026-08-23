import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSessionOrResponse } from '@/lib/auth/guard'
import { getDb } from '@/lib/db/client'
import { loadEnv } from '@/lib/env'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { syncConnection } from '@/lib/sync/transactions'

const body = z.object({ itemId: z.string().min(1) })

export async function POST(request: Request) {
  const guard = await requireSessionOrResponse()
  if (guard.response) return guard.response
  const session = guard.session

  const parsed = body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })

  const env = loadEnv()
  const pluggy = createPluggyClient({
    apiUrl: env.PLUGGY_API_URL,
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
  })

  let attached: { connectionId: string }
  try {
    attached = await attachConnection(getDb(), pluggy, {
      householdId: session.householdId,
      ownerUserId: session.id,
      itemId: parsed.data.itemId,
    })
  } catch (error) {
    // The itemId comes from the request body with no proof this session minted
    // the connect token behind it. attachConnection refuses one that already
    // belongs to another household; that is a caller error, not a 500.
    if (error instanceof Error && error.message === 'CONNECTION_OWNED_BY_ANOTHER_HOUSEHOLD') {
      return NextResponse.json({ error: 'CONNECTION_NOT_AVAILABLE' }, { status: 409 })
    }
    throw error
  }

  // Attaching alone leaves the user staring at an empty ledger (and a stale
  // banner) until a webhook or the 03:00 cron fires -- up to ~24h. Sync now.
  // A slow or failing first sync must not fail the connect: the connection row
  // is still worth keeping and reconcileAll will pick it up. Report it in the
  // response rather than swallowing it, and leave lastSyncedAt null so the
  // stale banner says so on screen.
  const { connectionId } = attached
  let synced = true
  try {
    await syncConnection(getDb(), pluggy, connectionId)
  } catch (error) {
    synced = false
    console.error('initial sync after connect failed', { connectionId, error })
  }

  return NextResponse.json({ connectionId, synced }, { status: 201 })
}
