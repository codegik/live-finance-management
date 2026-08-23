import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { createMailer } from '@/lib/email/resend'
import { loadEnv } from '@/lib/env'
import { createPluggyClient } from '@/lib/pluggy/client'
import { reconcileAll } from '@/lib/sync/reconcile'

// Kept for triggering a reconcile by hand. The scheduled run is a separate
// one-shot process (reconcile-job.ts) that calls reconcileAll directly, so
// this path carries no timeout budget of its own.
function authorizationMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(`Bearer ${expected}`)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  const env = loadEnv()
  if (!authorizationMatches(request.headers.get('authorization'), env.CRON_SECRET)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const pluggy = createPluggyClient({
    apiUrl: env.PLUGGY_API_URL,
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
  })

  const mailer = createMailer({ apiKey: env.RESEND_API_KEY, from: env.ALERT_EMAIL_FROM })

  const result = await reconcileAll(getDb(), pluggy, { mailer })

  const status =
    result.failed.length === 0 ? 200 : result.succeeded.length === 0 ? 500 : 207

  return NextResponse.json(result, { status })
}
