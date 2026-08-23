import { and, eq, inArray, sql } from 'drizzle-orm'
import { staleReason, type StaleReason } from '@/lib/domain/health'
import type { Db } from './client'
import { listHouseholdUsers } from './households'
import { accounts, connections, transactions, type Account, type Connection } from './schema'

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
  // Resolved: coalesce(household override, Pluggy's own value). This is
  // what budgeting/invoice logic elsewhere would read; it is deliberately
  // NOT what a form input should default to -- defaulting an input to the
  // resolved value would submit Pluggy's own figure back as an override the
  // household never chose to set.
  dueDay: number | null
  closingDay: number | null
  // The household's own override, unresolved. null means "no override" --
  // this is what a form input should default to, so saving one field never
  // silently pins the other.
  dueDayOverride: number | null
  closingDayOverride: number | null
  // Pluggy's own value, unresolved -- the UI shows this alongside the
  // resolved value so a household can see what the bank reports even after
  // overriding it.
  pluggyDueDay: number | null
  pluggyClosingDay: number | null
  dueDayOverridden: boolean
  closingDayOverridden: boolean
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
        dueDay: account.dueDayOverride ?? account.dueDay,
        closingDay: account.closingDayOverride ?? account.closingDay,
        dueDayOverride: account.dueDayOverride,
        closingDayOverride: account.closingDayOverride,
        pluggyDueDay: account.dueDay,
        pluggyClosingDay: account.closingDay,
        dueDayOverridden: account.dueDayOverride != null,
        closingDayOverridden: account.closingDayOverride != null,
      })),
  }))
}

/** How much history removing this connection would destroy. */
export async function countConnectionTransactions(
  db: Db,
  householdId: string,
  connectionId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(and(eq(connections.householdId, householdId), eq(connections.id, connectionId)))
  return Number(row?.count ?? 0)
}

/**
 * Removes a connection and, by FK cascade, its accounts and every
 * transaction in them. Scoped to the household in the DELETE itself, so a
 * connection id from elsewhere deletes nothing rather than deleting
 * someone else's history.
 */
export async function deleteConnection(
  db: Db,
  householdId: string,
  connectionId: string,
): Promise<{ removed: boolean }> {
  const rows = await db
    .delete(connections)
    .where(and(eq(connections.householdId, householdId), eq(connections.id, connectionId)))
    .returning({ id: connections.id })
  return { removed: rows.length > 0 }
}

/**
 * Sets the household's own due and closing day for one account. Null clears
 * the override and falls back to whatever Pluggy reports.
 */
export async function setAccountDays(
  db: Db,
  householdId: string,
  accountId: string,
  days: { dueDay: number | null; closingDay: number | null },
): Promise<{ updated: boolean }> {
  const rows = await db
    .update(accounts)
    .set({ dueDayOverride: days.dueDay, closingDayOverride: days.closingDay })
    .where(
      and(
        eq(accounts.id, accountId),
        // Scoped in the UPDATE itself: an account id from another household
        // must update nothing, not merely be checked first.
        inArray(
          accounts.connectionId,
          db.select({ id: connections.id }).from(connections).where(eq(connections.householdId, householdId)),
        ),
      ),
    )
    .returning({ id: accounts.id })
  return { updated: rows.length > 0 }
}
