import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { createInvite } from '@/lib/db/invites'

const body = z.object({ email: z.string().email(), name: z.string().min(1) })

export async function POST(request: Request) {
  const session = await requireSession()
  const parsed = body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })

  const { token } = await createInvite(getDb(), {
    householdId: session.householdId,
    email: parsed.data.email,
    name: parsed.data.name,
  })

  return NextResponse.json({ inviteUrl: `/join/${token}` }, { status: 201 })
}
