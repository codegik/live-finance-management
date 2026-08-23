import { eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { accounts, connections, transactions } from '@/lib/db/schema'
import { mapTransaction } from '@/lib/pluggy/mapper'
import type { PluggyClient } from '@/lib/pluggy/client'

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
  const localAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.connectionId, connectionId))

  let upserted = 0

  for (const account of localAccounts) {
    const remote = await pluggy.listTransactions(account.pluggyAccountId)

    for (const tx of remote) {
      const row = mapTransaction(tx, account.id)
      await db
        .insert(transactions)
        .values(row)
        .onConflictDoUpdate({
          target: transactions.pluggyTransactionId,
          set: {
            date: row.date,
            amountCents: row.amountCents,
            description: row.description,
            merchantRaw: row.merchantRaw,
            pluggyCategory: row.pluggyCategory,
            updatedAt: new Date(),
          },
        })
      upserted += 1
    }
  }

  await db
    .update(connections)
    .set({ status: item.status, lastSyncedAt: new Date() })
    .where(eq(connections.id, connectionId))

  return { upserted }
}
