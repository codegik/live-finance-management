import { and, eq } from 'drizzle-orm'
import type { Db } from './client'
import { accounts, connections, type Account, type Connection } from './schema'

export async function listConnections(db: Db, householdId: string): Promise<Connection[]> {
  return db.select().from(connections).where(eq(connections.householdId, householdId))
}

// Scoped by household in the query itself: an update-mode connect token must
// never be minted for an item id the caller's household does not own, and the
// caller only supplies the item id, not proof of ownership.
export async function connectionByItemId(
  db: Db,
  householdId: string,
  itemId: string,
): Promise<Connection | null> {
  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.householdId, householdId), eq(connections.pluggyItemId, itemId)))
    .limit(1)
  return row ?? null
}

export async function listAccounts(
  db: Db,
  householdId: string,
): Promise<(Account & { ownerUserId: string; institution: string })[]> {
  const rows = await db
    .select({ account: accounts, connection: connections })
    .from(accounts)
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(eq(connections.householdId, householdId))

  return rows.map((r) => ({
    ...r.account,
    ownerUserId: r.connection.ownerUserId,
    institution: r.connection.institution,
  }))
}
