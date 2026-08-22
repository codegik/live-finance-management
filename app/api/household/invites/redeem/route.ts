import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { redeemInvite } from '@/lib/db/invites'

const body = z.object({ token: z.string().min(1), password: z.string().min(8) })

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })

  try {
    await redeemInvite(getDb(), parsed.data)
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'INVALID_INVITE' }, { status: 400 })
  }
}
