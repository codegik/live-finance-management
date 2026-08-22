import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { loadEnv } from '@/lib/env'
import { createPluggyClient } from '@/lib/pluggy/client'
import { reconcileAll } from '@/lib/sync/reconcile'

export const maxDuration = 300

export async function GET(request: Request) {
  const env = loadEnv()
  if (request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const pluggy = createPluggyClient({
    apiUrl: env.PLUGGY_API_URL,
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
  })

  const result = await reconcileAll(getDb(), pluggy)

  return NextResponse.json(result)
}
