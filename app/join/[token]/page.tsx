import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { redeemInvite } from '@/lib/db/invites'

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  async function submit(formData: FormData) {
    'use server'
    await redeemInvite(getDb(), {
      token,
      password: String(formData.get('password') ?? ''),
    })
    redirect('/signin')
  }

  return (
    <main className="page page--narrow">
      <h1>Join the household</h1>
      <form action={submit}>
        <label>
          Choose a password
          <input name="password" type="password" required minLength={8} autoComplete="new-password" />
        </label>
        <button type="submit">Join</button>
      </form>
    </main>
  )
}
