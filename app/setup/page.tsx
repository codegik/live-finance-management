import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { countHouseholds } from '@/lib/db/households'
import { SetupForm } from './SetupForm'

// Registration is invite-only, so nothing else can create the first
// household. This page exists only while there is none: once one exists it is
// gone for good, which is what makes a one-time setup route safe to expose.
// The check here is for the visitor's benefit; the guarantee is the
// transaction inside createFirstHousehold().
export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  if ((await countHouseholds(getDb())) > 0) notFound()

  return (
    <main className="mx-auto max-w-[34rem] px-[0.85rem] pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-4 min-[52rem]:px-5 min-[52rem]:pb-[4.5rem] min-[52rem]:pt-6">
      <h1>Set up your household</h1>
      <p>
        This creates the first account. Everyone else joins by invitation, and this page
        disappears once it is done.
      </p>
      <SetupForm />
    </main>
  )
}
