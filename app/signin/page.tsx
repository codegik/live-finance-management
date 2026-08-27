import Link from 'next/link'
import { localAutoLogin } from '@/lib/demo/autologin'
import { SignInForm } from './SignInForm'

export const dynamic = 'force-dynamic'

export default function SignInPage() {
  const local = localAutoLogin()

  return (
    <main className="mx-auto max-w-[34rem] px-[0.85rem] pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-4 min-[52rem]:px-5 min-[52rem]:pb-[4.5rem] min-[52rem]:pt-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-[0.15rem]">
          <h1>Entrar</h1>
        </div>
      </header>

      {/* Only ever rendered locally: localAutoLogin() returns null unless the
          switch is on, the build is not production and the database is on this
          machine. It is a link rather than an automatic redirect so that
          reaching /signin on purpose -- to sign in as somebody else -- still
          works. */}
      {local ? (
        <p className="mb-4">
          <Link
            href="/dev-login"
            className="rounded-sm border border-border bg-transparent px-[0.6rem] py-[0.32rem] text-[0.8rem] text-text-dim hover:bg-surface-3 hover:text-foreground hover:no-underline"
          >
            Entrar como {local.email} (ambiente local)
          </Link>
        </p>
      ) : null}

      <SignInForm />
    </main>
  )
}
