import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/auth/session'
import { localAutoLogin } from '@/lib/demo/autologin'

export const dynamic = 'force-dynamic'

export default async function Home() {
  // Local development only, and only when nobody is signed in: hand off to the
  // dev-login route, which signs in as the seeded household so the app opens
  // on real screens instead of a login form. localAutoLogin() returns null in
  // every other case, including any production build, so this is a straight
  // redirect to /dashboard everywhere else -- exactly as it was.
  if (localAutoLogin()) {
    // requireSession rather than auth(): a token naming a household that no
    // longer exists is valid to Auth.js and useless to every screen, and it is
    // exactly what a database reset leaves in the browser.
    const signedIn = await requireSession().then(
      () => true,
      () => false,
    )
    if (!signedIn) redirect('/dev-login')
  }

  redirect('/dashboard')
}
