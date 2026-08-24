import { and, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import NextAuth, { type Session, type User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import Credentials from 'next-auth/providers/credentials'
import type { Executor } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { localAutoLogin } from '@/lib/demo/autologin'
import { authorizeCredentials, type SessionUser } from './config'

export function attachHouseholdToToken({
  token,
  user,
}: {
  token: JWT
  user?: User | null
}): JWT {
  if (user) token.householdId = (user as SessionUser).householdId
  return token
}

export function attachHouseholdToSession({
  session,
  token,
}: {
  session: Session
  token: JWT
}): Session {
  if (session.user) {
    session.user.id = token.sub!
    session.user.householdId = token.householdId as string
  }
  return session
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Auth.js only trusts the incoming Host header automatically on Vercel,
  // which it detects by env var. Anywhere else — Railway included — every
  // request is rejected as UntrustedHost until this is set. The platform
  // terminates TLS and sets the header itself, so trusting it is correct here.
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const email = typeof raw?.email === 'string' ? raw.email : ''
        const password = typeof raw?.password === 'string' ? raw.password : ''
        const user = await authorizeCredentials(getDb(), { email, password })
        return user ? { ...user } : null
      },
    }),
  ],
  callbacks: {
    jwt: attachHouseholdToToken,
    session: attachHouseholdToSession,
  },
})

/**
 * Whether the signed-in identity still exists as claimed.
 *
 * The household id is written into the JWT at sign-in and never revisited, so
 * a token outlives the row it names: after the database is reset and reseeded
 * the browser still holds a valid, correctly-signed token pointing at a
 * household that is gone. The user is then authenticated as a ghost -- every
 * query is scoped to a household with nothing in it, so /ledger renders "No
 * transactions yet. Connect a card to get started." on a database holding
 * three thousand of them.
 *
 * That is the worst failure available here: it is indistinguishable from
 * having no data, so it sends someone looking for a bug in their data rather
 * than signing in again. Cheap to prevent -- one lookup on the user's primary
 * key -- and the alternative is a screen that lies.
 */
export async function sessionIsStillValid(
  exec: Executor,
  userId: string,
  householdId: string,
): Promise<boolean> {
  const rows = await exec
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.householdId, householdId)))
    .limit(1)
  return rows.length > 0
}

export async function requireSession(): Promise<SessionUser> {
  const session = await auth()
  const user = session?.user
  if (!user?.householdId || !user.id) throw new Error('UNAUTHENTICATED')

  if (!(await sessionIsStillValid(getDb(), user.id, user.householdId))) {
    // Not an error state to report -- the token is simply stale. Sending it
    // back through sign-in issues a fresh one naming the household that now
    // exists.
    throw new Error('UNAUTHENTICATED')
  }

  return {
    id: user.id,
    email: user.email!,
    name: user.name ?? '',
    householdId: user.householdId,
  }
}

/**
 * A server component that calls requireSession() cannot let its
 * UNAUTHENTICATED throw escape uncaught -- Next renders that as a generic
 * 500 page, and "you're not signed in" isn't a server error. Route the
 * catch here so any other failure (a real DB/auth error) still propagates
 * and surfaces as a 500, which is correct for that case.
 */
export function toSignInOrThrow(error: unknown): never {
  if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
    // Locally, hand off to the route that signs in as the seeded household
    // rather than to a form. Reaching a protected page signed out is the
    // common case after a database reset, and "log in again" is not the point
    // of a local environment. localAutoLogin() is null everywhere else, so
    // every other deployment still goes to /signin exactly as before.
    redirect(localAutoLogin() ? '/dev-login' : '/signin')
  }
  throw error
}
