import { and, eq } from 'drizzle-orm'
import { staleReason, type StaleReason } from '@/lib/domain/health'
import type { Db } from './client'
import { listHouseholdUsers } from './households'
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

export type ConnectionAccount = {
  id: string
  type: 'CREDIT' | 'BANK'
  name: string
  last4: string | null
  dueDay: number | null
}

export type ConnectionDetail = {
  id: string
  institution: string
  ownerName: string
  status: Connection['status']
  lastSyncedAt: Date | null
  pluggyItemId: string
  stale: StaleReason | null
  accounts: ConnectionAccount[]
}

/**
 * Everything the connections screen shows, in one household-scoped read.
 *
 * `stale` is resolved here rather than on the page so the screen and the
 * banner cannot disagree about which connection is broken.
 */
export async function listConnectionDetails(
  db: Db,
  householdId: string,
  opts: { now?: Date } = {},
): Promise<ConnectionDetail[]> {
  const now = opts.now ?? new Date()
  const [rows, members] = await Promise.all([
    listConnections(db, householdId),
    listHouseholdUsers(db, householdId),
  ])
  const nameByUserId = new Map(members.map((m) => [m.id, m.name]))
  const all = await listAccounts(db, householdId)

  return rows.map((connection) => ({
    id: connection.id,
    institution: connection.institution,
    ownerName: nameByUserId.get(connection.ownerUserId) ?? 'Unknown',
    status: connection.status,
    lastSyncedAt: connection.lastSyncedAt,
    pluggyItemId: connection.pluggyItemId,
    stale: staleReason(connection, now),
    accounts: all
      .filter((account) => account.connectionId === connection.id)
      .map((account) => ({
        id: account.id,
        type: account.type,
        name: account.name,
        last4: account.last4,
        dueDay: account.dueDay,
      })),
  }))
}
