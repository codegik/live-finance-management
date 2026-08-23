import { NextResponse } from 'next/server'
import type { SessionUser } from './config'
import { requireSession } from './session'

export type SessionGuard =
  | { session: SessionUser; response?: undefined }
  | { session?: undefined; response: NextResponse }

/**
 * requireSession() throws UNAUTHENTICATED, which Next renders as a 500 -- so
 * ordinary logged-out traffic would page whoever is on call. API routes need
 * a clean 401 instead, matching the unauthenticated cron and webhook routes.
 * Any other failure still propagates, because that IS a server error.
 *
 * requireSession() itself is deliberately left alone: server components rely
 * on its throw (see toSignInOrThrow).
 */
export async function requireSessionOrResponse(): Promise<SessionGuard> {
  try {
    return { session: await requireSession() }
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
      return { response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) }
    }
    throw error
  }
}
