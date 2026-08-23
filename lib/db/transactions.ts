import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import type { Db, Executor } from './client'
import { accounts, connections, transactions } from './schema'

export type TransactionRow = {
  id: string
  pluggyTransactionId: string
  date: string
  amountCents: number
  description: string
  merchantRaw: string | null
  merchantNormalized: string | null
  pluggyCategory: string | null
  categoryId: string | null
  categorySource: 'PLUGGY' | 'RULE' | 'MANUAL' | null
  accountName: string
  accountLast4: string | null
  institution: string
  ownerUserId: string
}

export async function listTransactions(
  db: Db,
  householdId: string,
  opts: { from?: string; to?: string } = {},
): Promise<TransactionRow[]> {
  const filters = [eq(connections.householdId, householdId)]
  if (opts.from) filters.push(gte(transactions.date, opts.from))
  if (opts.to) filters.push(lte(transactions.date, opts.to))

  const rows = await db
    .select({ transaction: transactions, account: accounts, connection: connections })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(and(...filters))
    // createdAt alone doesn't break ties deterministically: every row from a
    // single sync gets a near-identical defaultNow() timestamp, so same-day
    // rows could reorder between calls. id is a stable, unique tiebreaker.
    .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))

  return rows.map(({ transaction, account, connection }) => ({
    id: transaction.id,
    pluggyTransactionId: transaction.pluggyTransactionId,
    date: transaction.date,
    amountCents: transaction.amountCents,
    description: transaction.description,
    merchantRaw: transaction.merchantRaw,
    merchantNormalized: transaction.merchantNormalized,
    pluggyCategory: transaction.pluggyCategory,
    categoryId: transaction.categoryId,
    categorySource: transaction.categorySource,
    accountName: account.name,
    accountLast4: account.last4,
    institution: connection.institution,
    ownerUserId: connection.ownerUserId,
  }))
}

/** Transaction ids belonging to a household, as a subquery for scoped writes. */
export function householdTransactionIds(exec: Executor, householdId: string) {
  return exec
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(eq(connections.householdId, householdId))
}

/** A hand-set category. MANUAL is what protects it from every later sync. */
export async function setTransactionCategory(
  exec: Executor,
  householdId: string,
  transactionId: string,
  categoryId: string,
): Promise<void> {
  await exec
    .update(transactions)
    .set({ categoryId, categorySource: 'MANUAL', updatedAt: new Date() })
    .where(
      and(
        eq(transactions.id, transactionId),
        inArray(transactions.id, householdTransactionIds(exec, householdId)),
      ),
    )
}

/**
 * Assigns every uncategorized transaction of one merchant by hand.
 *
 * Only uncategorized rows are touched: this is the inbox's "just these, no
 * rule" path, and it must not silently restate rows that a rule or Pluggy
 * already categorized correctly.
 */
export async function setCategoryForMerchant(
  exec: Executor,
  householdId: string,
  merchant: string | null,
  categoryId: string,
): Promise<{ changed: number }> {
  const rows = await exec
    .update(transactions)
    .set({ categoryId, categorySource: 'MANUAL', updatedAt: new Date() })
    .where(
      and(
        merchant === null
          ? isNull(transactions.merchantNormalized)
          : eq(transactions.merchantNormalized, merchant),
        isNull(transactions.categoryId),
        inArray(transactions.id, householdTransactionIds(exec, householdId)),
      ),
    )
    .returning({ id: transactions.id })

  return { changed: rows.length }
}
