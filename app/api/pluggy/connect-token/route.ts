import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSessionOrResponse } from '@/lib/auth/guard'
import { getDb } from '@/lib/db/client'
import { connectionByItemId } from '@/lib/db/connections'
import { loadEnv } from '@/lib/env'
import { createPluggyClient } from '@/lib/pluggy/client'

const body = z.object({ itemId: z.string().min(1).optional() })

export async function POST(request: Request) {
  const guard = await requireSessionOrResponse()
  if (guard.response) return guard.response
  const session = guard.session

  // The button posts an empty body when connecting a new bank, and some
  // callers post nothing at all; neither is an error.
  const parsed = body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  const itemId = parsed.data.itemId

  // An update-mode token reopens an existing bank connection. The item id
  // arrives from the client, so it is proof of nothing: without this check a
  // signed-in user could name any item id and be handed a token for it.
  if (itemId && !(await connectionByItemId(getDb(), session.householdId, itemId))) {
    return NextResponse.json({ error: 'UNKNOWN_CONNECTION' }, { status: 404 })
  }

  const env = loadEnv()
  const pluggy = createPluggyClient({
    apiUrl: env.PLUGGY_API_URL,
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
  })

  return NextResponse.json({ accessToken: await pluggy.createConnectToken(itemId) })
}
