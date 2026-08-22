import { redirect } from 'next/navigation'
import { signIn } from '@/lib/auth/session'

export default function SignInPage() {
  async function submit(formData: FormData) {
    'use server'
    await signIn('credentials', {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      redirectTo: '/ledger',
    })
    redirect('/ledger')
  }

  return (
    <main className="page page--narrow">
      <h1>Sign in</h1>
      <form action={submit}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  )
}
