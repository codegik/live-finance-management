import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { getDb } from '@/lib/db/client'
import { authorizeCredentials, type SessionUser } from './config'

export const { handlers, auth, signIn, signOut } = NextAuth({
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
    jwt: ({ token, user }) => {
      if (user) token.householdId = (user as SessionUser).householdId
      return token
    },
    session: ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub!
        session.user.householdId = token.householdId as string
      }
      return session
    },
  },
})

export async function requireSession(): Promise<SessionUser> {
  const session = await auth()
  const user = session?.user
  if (!user?.householdId) throw new Error('UNAUTHENTICATED')
  return {
    id: user.id!,
    email: user.email!,
    name: user.name ?? '',
    householdId: user.householdId,
  }
}
