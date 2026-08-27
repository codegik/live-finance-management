import Link from 'next/link'
import type { HouseholdHealth } from '@/lib/db/health'

export function StaleBanner({ health }: { health: HouseholdHealth }) {
  if (health.allFresh) return null

  return (
    <aside
      role="alert"
      className="mb-4 flex gap-[0.6rem] rounded-md border border-warn/40 bg-warn-dim px-[0.9rem] py-[0.7rem] text-[0.85rem] text-warn"
    >
      <strong>Some data may be missing.</strong>
      <ul>
        {health.stale.map((s) => (
          <li key={s.connectionId}>
            <Link href="/settings/connections">{s.institution}</Link>{' '}
            {s.reason === 'NEEDS_REAUTH' ? 'needs reconnecting' : 'has not updated recently'}
          </li>
        ))}
      </ul>
    </aside>
  )
}
