import { JoinForm } from './JoinForm'

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  return (
    <main className="page page--narrow">
      <h1>Join the household</h1>
      <JoinForm token={token} />
    </main>
  )
}
