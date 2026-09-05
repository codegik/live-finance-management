import { eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { accounts, connections, transactions } from '@/lib/db/schema'
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

export async function syncConnection(
  db: Db,
  pluggy: PluggyClient,
  connectionId: string,
  opts: { now?: Date } = {},
): Promise<{ upserted: number }> {
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

  let upserted = 0
  const touched: string[] = []

  for (const account of localAccounts) {
    const remote = await pluggy.listTransactions(account.pluggyAccountId)

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
      upserted += 1
    }
  }

  // Categorize what this sync touched. MANUAL rows are excluded inside
  // recategorize, which is what makes a hand-set category survive.
  await recategorize(db, { householdId: connection.householdId, transactionIds: touched })

  await db
    .update(connections)
    .set({ status: item.status, lastSyncedAt: new Date() })
    .where(eq(connections.id, connectionId))

  return { upserted }
}
