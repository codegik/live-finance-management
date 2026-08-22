import type { HouseholdHealth } from '@/lib/db/health'

export function StaleBanner({ health }: { health: HouseholdHealth }) {
  if (health.allFresh) return null

  return (
    <aside role="alert" className="banner banner--stale">
      <strong>Some data may be missing.</strong>
      <ul>
        {health.stale.map((s) => (
          <li key={s.connectionId}>
            {s.institution}{' '}
            {s.reason === 'NEEDS_REAUTH' ? 'needs reconnecting' : 'has not updated recently'}
          </li>
        ))}
      </ul>
    </aside>
  )
}
