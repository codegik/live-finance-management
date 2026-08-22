import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { loadEnv } from '@/lib/env'
import { createPluggyClient } from '@/lib/pluggy/client'
import { syncByItemId } from '@/lib/sync/dispatch'

const body = z.object({ event: z.string().min(1), itemId: z.string().min(1) })

function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const env = loadEnv()
  const token = new URL(request.url).searchParams.get('token')
  if (!tokenMatches(token, env.PLUGGY_WEBHOOK_TOKEN)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const parsed = body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })

  const pluggy = createPluggyClient({
    apiUrl: env.PLUGGY_API_URL,
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
  })

  const { synced } = await syncByItemId(getDb(), pluggy, parsed.data.itemId)

  return synced
    ? NextResponse.json({ ok: true }, { status: 200 })
    : NextResponse.json({ ok: true, ignored: true }, { status: 202 })
}
