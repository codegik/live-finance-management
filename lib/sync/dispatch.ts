import { eq } from 'drizzle-orm'
import { evaluateAndNotify } from '@/lib/alerts/evaluate'
import type { Db } from '@/lib/db/client'
import { connections } from '@/lib/db/schema'
import type { Mailer } from '@/lib/email/resend'
import type { PluggyClient } from '@/lib/pluggy/client'
import { syncConnection } from './transactions'

export async function syncByItemId(
  db: Db,
  pluggy: PluggyClient,
  itemId: string,
  deps: { mailer: Mailer; now?: Date },
): Promise<{ synced: boolean }> {
  const [connection] = await db
    .select({ id: connections.id, householdId: connections.householdId })
    .from(connections)
    .where(eq(connections.pluggyItemId, itemId))
    .limit(1)

  if (!connection) return { synced: false }

  await syncConnection(db, pluggy, connection.id)

  // Alerts must never fail a sync: a Resend outage would otherwise 500 the
  // webhook and make Pluggy retry the whole sync over a mail that was never
  // the point. The unsent threshold stays armed, so the retry is the next
  // sync rather than this one.
  try {
    await evaluateAndNotify(db, deps.mailer, connection.householdId, { now: deps.now })
  } catch (error) {
    console.error('alerts failed', { householdId: connection.householdId, error })
  }

  return { synced: true }
}
