import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { loadEnv } from '@/lib/env'
import { createPluggyClient } from '@/lib/pluggy/client'

export async function POST() {
  await requireSession()
  const env = loadEnv()

  const pluggy = createPluggyClient({
    apiUrl: env.PLUGGY_API_URL,
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
  })

  return NextResponse.json({ accessToken: await pluggy.createConnectToken() })
}
