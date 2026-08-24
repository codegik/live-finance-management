import { NextResponse } from 'next/server'
import { auth, sessionIsStillValid, signIn } from '@/lib/auth/session'
import { isNextRedirectError } from '@/lib/errors'
import { getDb } from '@/lib/db/client'
import { localAutoLogin } from '@/lib/demo/autologin'

export const dynamic = 'force-dynamic'

/** Only ever used locally, where the app is reached on this address. */
const BASE = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

/**
 * Signs in as the seeded local household, so a local start opens on a
 * populated app instead of a login form.
 *
 * A route handler rather than something the root page does during render:
 * signing in sets a cookie, and Next 15 does not allow that from a render
 * pass. It goes through the ordinary credentials provider, so a wrong or
 * missing local account fails exactly as a hand-typed one would.
 *
 * 404s when auto-login is not enabled -- not 403. There is nothing here to
 * discover on a deployment that has it off, and saying "forbidden" would
 * confirm the route exists.
 */
export async function GET() {
  const credentials = localAutoLogin()
  if (!credentials) return new NextResponse('Not found', { status: 404 })

  // Already signed in AS SOMEONE WHO STILL EXISTS: nothing to do, and
  // re-issuing a session on every visit to `/` would throw away whichever
  // account is actually in use.
  //
  // The validity check is what stops a loop rather than what starts one:
  // requireSession() sends a stale token here, and a bare `if (session)` would
  // bounce it straight back to /dashboard to be rejected again, forever.
  const session = await auth()
  const stillValid =
    session?.user?.id && session.user.householdId
      ? await sessionIsStillValid(getDb(), session.user.id, session.user.householdId)
      : false
  if (stillValid) return NextResponse.redirect(new URL('/dashboard', BASE))

  try {
    await signIn('credentials', { ...credentials, redirectTo: '/dashboard' })
  } catch (error) {
    // On success signIn throws the NEXT_REDIRECT that navigates onward.
    if (isNextRedirectError(error)) throw error
    // Anything else means the seeded account is missing or its password has
    // been changed. Send the user to the form rather than to an error page --
    // signing in by hand still works, and ./seed.sh prints the credentials.
    return NextResponse.redirect(new URL('/signin', BASE))
  }

  return NextResponse.redirect(new URL('/dashboard', BASE))
}
