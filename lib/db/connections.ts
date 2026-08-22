import { eq } from 'drizzle-orm'
import type { Db } from './client'
import { accounts, connections, type Account, type Connection } from './schema'

export async function listConnections(db: Db, householdId: string): Promise<Connection[]> {
  return db.select().from(connections).where(eq(connections.householdId, householdId))
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
