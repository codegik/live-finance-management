import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { loadEnv } from '@/lib/env'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'

const body = z.object({ itemId: z.string().min(1) })

export async function POST(request: Request) {
  const session = await requireSession()
  const parsed = body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })

  const env = loadEnv()
  const pluggy = createPluggyClient({
    apiUrl: env.PLUGGY_API_URL,
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
  })

  const { connectionId } = await attachConnection(getDb(), pluggy, {
    householdId: session.householdId,
    ownerUserId: session.id,
    itemId: parsed.data.itemId,
  })

  return NextResponse.json({ connectionId }, { status: 201 })
}
