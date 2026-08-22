import type { Db } from '@/lib/db/client'
import { connections } from '@/lib/db/schema'
import type { PluggyClient } from '@/lib/pluggy/client'
import { syncConnection } from './transactions'

export async function reconcileAll(
  db: Db,
  pluggy: PluggyClient,
  opts: { now?: Date } = {},
): Promise<{ succeeded: string[]; failed: string[] }> {
  const all = await db.select({ id: connections.id }).from(connections)

  const succeeded: string[] = []
  const failed: string[] = []

  for (const connection of all) {
    try {
      await syncConnection(db, pluggy, connection.id, { now: opts.now })
      succeeded.push(connection.id)
    } catch (error) {
      console.error('reconcile failed', { connectionId: connection.id, error })
      failed.push(connection.id)
    }
  }

  return { succeeded, failed }
}
