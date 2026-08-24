import Link from 'next/link'
import { localAutoLogin } from '@/lib/demo/autologin'
import { SignInForm } from './SignInForm'

export const dynamic = 'force-dynamic'

export default function SignInPage() {
  const local = localAutoLogin()

  return (
    <main className="page page--narrow">
      <header className="page__header">
        <div className="page__title">
          <h1>Entrar</h1>
        </div>
      </header>

      {/* Only ever rendered locally: localAutoLogin() returns null unless the
          switch is on, the build is not production and the database is on this
          machine. It is a link rather than an automatic redirect so that
          reaching /signin on purpose -- to sign in as somebody else -- still
          works. */}
      {local ? (
        <p className="signin__local">
          <Link href="/dev-login" className="btn-quiet">
            Entrar como {local.email} (ambiente local)
          </Link>
        </p>
      ) : null}

      <SignInForm />
    </main>
  )
}
