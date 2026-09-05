import { and, eq, gte, isNull, ne, notInArray, or } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { accounts, connections, transactions } from '@/lib/db/schema'
import { daysBefore } from '@/lib/domain/dates'
import { mapTransaction } from '@/lib/pluggy/mapper'
import type { PluggyClient } from '@/lib/pluggy/client'
import { refreshAccounts } from './accounts'
import { recategorize } from './categorize'

/**
 * Pluggy's v2 transactions endpoint has no transaction-date filter, so a
 * rolling window cannot be requested server-side any more. Every sync reads
 * the account's full history and leans on the upsert, which is idempotent by
 * construction. `createdAtFrom` exists but filters on when Pluggy created the
 * record, so it would miss exactly what the reconcile is for: older
 * transactions that later mutate.
 */

/**
 * How far back the orphan prune looks.
 *
 * A charge can leave the feed under its old id and return under a new one --
 * Pluggy warns the id changes when a PENDING authorization settles, or when a
 * charge's date/amount shifts enough that it re-posts as a new record. The
 * upsert keys on that id, so the stale copy would otherwise linger forever as a
 * duplicate. Deleting local rows the feed no longer lists removes it.
 *
 * Bounded to recent dates on purpose: this churn only happens around the open
 * and just-closed faturas, never in settled history, and Pluggy's per-connector
 * history window may be SHORTER than the three years the household keeps. An
 * unbounded prune would read "old but still returned by us, absent from a
 * 12-month feed" as an orphan and delete real history. 90 days covers an open
 * cycle and the one before it with room to spare, and never reaches the deep
 * history that only the bank could re-supply.
 */
const ORPHAN_PRUNE_DAYS = 90

export async function syncConnection(
  db: Db,
  pluggy: PluggyClient,
  connectionId: string,
  opts: { now?: Date } = {},
): Promise<{ upserted: number; pruned: number }> {
  const [connection] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1)
  if (!connection) throw new Error('UNKNOWN_CONNECTION')

  const item = await pluggy.getItem(connection.pluggyItemId)

  // Before reading local accounts, not after: an account opened since the
  // last sync must be in the list this sync then walks.
  await refreshAccounts(db, pluggy, connectionId, connection.pluggyItemId)

  const localAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.connectionId, connectionId))

  const now = opts.now ?? new Date()
  let upserted = 0
  let pruned = 0
  const touched: string[] = []

  for (const account of localAccounts) {
    const remote = await pluggy.listTransactions(account.pluggyAccountId)

    const remoteIds: string[] = []
    for (const tx of remote) {
      const row = mapTransaction(tx, { id: account.id, type: account.type })
      const [written] = await db
        .insert(transactions)
        .values(row)
        .onConflictDoUpdate({
          target: transactions.pluggyTransactionId,
          set: {
            date: row.date,
            amountCents: row.amountCents,
            description: row.description,
            merchantRaw: row.merchantRaw,
            merchantNormalized: row.merchantNormalized,
            pluggyCategory: row.pluggyCategory,
            budgetRole: row.budgetRole,
            // Re-read every sync so a charge that has since settled loses its
            // provisional mark, and one newly authorized gains it.
            pending: row.pending,
            installmentNumber: row.installmentNumber,
            installmentTotal: row.installmentTotal,
            updatedAt: new Date(),
          },
        })
        .returning({ id: transactions.id })
      touched.push(written.id)
      remoteIds.push(row.pluggyTransactionId)
      upserted += 1
    }

    // Prune duplicates left behind when a charge re-posts under a new id.
    //
    // Two guards make this safe to delete on:
    //   - Empty feed: a transient sync that returns nothing must never be read
    //     as "the account has no transactions" and wipe it -- with no remote
    //     ids, notInArray would match every local row.
    //   - MANUAL rows: a charge the household has categorized by hand carries
    //     human intent, so it is never silently deleted even if it drops out of
    //     the feed. A sync-derived row (null / PLUGGY / RULE) is pure
    //     projection of the feed and safe to remove once the feed no longer
    //     lists it. See ORPHAN_PRUNE_DAYS for why this is bounded to recent
    //     dates.
    if (remoteIds.length > 0) {
      const deleted = await db
        .delete(transactions)
        .where(
          and(
            eq(transactions.accountId, account.id),
            gte(transactions.date, daysBefore(ORPHAN_PRUNE_DAYS, now)),
            notInArray(transactions.pluggyTransactionId, remoteIds),
            or(
              isNull(transactions.categorySource),
              ne(transactions.categorySource, 'MANUAL'),
            ),
          ),
        )
        .returning({ id: transactions.id })
      pruned += deleted.length
    }
  }

  // Categorize what this sync touched. MANUAL rows are excluded inside
  // recategorize, which is what makes a hand-set category survive.
  await recategorize(db, { householdId: connection.householdId, transactionIds: touched })

  await db
    .update(connections)
    .set({ status: item.status, lastSyncedAt: new Date() })
    .where(eq(connections.id, connectionId))

  return { upserted, pruned }
}
