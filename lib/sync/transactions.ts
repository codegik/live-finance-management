import { eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { accounts, connections, transactions } from '@/lib/db/schema'
import { daysBefore } from '@/lib/domain/dates'
import { mapTransaction } from '@/lib/pluggy/mapper'
import type { PluggyClient } from '@/lib/pluggy/client'

export const RECONCILE_WINDOW_DAYS = 90

export async function syncConnection(
  db: Db,
  pluggy: PluggyClient,
  connectionId: string,
  opts: { fromDate?: string; now?: Date } = {},
): Promise<{ upserted: number }> {
  const [connection] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1)
  if (!connection) throw new Error('UNKNOWN_CONNECTION')

  const item = await pluggy.getItem(connection.pluggyItemId)
  const from = opts.fromDate ?? daysBefore(RECONCILE_WINDOW_DAYS, opts.now ?? new Date())
  const localAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.connectionId, connectionId))

  let upserted = 0

  for (const account of localAccounts) {
    const remote = await pluggy.listTransactions(account.pluggyAccountId, from)

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
