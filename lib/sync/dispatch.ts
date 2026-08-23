import { eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { connections } from '@/lib/db/schema'
import type { PluggyClient } from '@/lib/pluggy/client'
import { syncConnection } from './transactions'

export async function syncByItemId(
  db: Db,
  pluggy: PluggyClient,
  itemId: string,
): Promise<{ synced: boolean }> {
  const [connection] = await db
    .select({ id: connections.id })
    .from(connections)
    .where(eq(connections.pluggyItemId, itemId))
    .limit(1)

  if (!connection) return { synced: false }

  await syncConnection(db, pluggy, connection.id)
  return { synced: true }
}
