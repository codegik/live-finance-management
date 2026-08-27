import { JoinForm } from './JoinForm'

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  return (
    <main className="mx-auto max-w-[34rem] px-[0.85rem] pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-4 min-[52rem]:px-5 min-[52rem]:pb-[4.5rem] min-[52rem]:pt-6">
      <h1>Join the household</h1>
      <JoinForm token={token} />
    </main>
  )
}
