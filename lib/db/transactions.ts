import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { categoryBelongsToHousehold } from './categories'
import type { Db, Executor } from './client'
import { accounts, categories, connections, transactions } from './schema'

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
  categoryName: string | null
  isTransfer: boolean
  installmentNumber: number | null
  installmentTotal: number | null
  accountName: string
  accountLast4: string | null
  institution: string
  ownerUserId: string
}

export async function listTransactions(
  db: Db,
  householdId: string,
  opts: { from?: string; to?: string; includeTransfers?: boolean } = {},
): Promise<TransactionRow[]> {
  const filters = [eq(connections.householdId, householdId)]
  if (opts.from) filters.push(gte(transactions.date, opts.from))
  if (opts.to) filters.push(lte(transactions.date, opts.to))
  // Invoice payments and fees are not spending. Callers that want them --
  // the ledger's "show transfers" toggle -- ask explicitly.
  if (!opts.includeTransfers) filters.push(eq(transactions.isTransfer, false))

  const rows = await db
    .select({ transaction: transactions, account: accounts, connection: connections, category: categories })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    // Left, not inner: an uncategorized transaction must still appear here --
    // that is the entire point of the badge that links to the inbox.
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(...filters))
    // createdAt alone doesn't break ties deterministically: every row from a
    // single sync gets a near-identical defaultNow() timestamp, so same-day
    // rows could reorder between calls. id is a stable, unique tiebreaker.
    .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))

  return rows.map(({ transaction, account, connection, category }) => ({
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
    categoryName: category?.name ?? null,
    isTransfer: transaction.isTransfer,
    installmentNumber: transaction.installmentNumber,
    installmentTotal: transaction.installmentTotal,
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

/**
 * A hand-set category. MANUAL is what protects it from every later sync.
 *
 * Deferred seam: per-transaction correction lands in Slice 3. Today the inbox
 * only surfaces category_id IS NULL rows, so nothing in production calls this
 * — a wrongly categorized transaction can currently only be fixed with a
 * merchant rule, which is the wrong granularity for a one-off. Exercised by
 * tests so the seam stays correct until the UI arrives.
 */
export async function setTransactionCategory(
  exec: Executor,
  householdId: string,
  transactionId: string,
  categoryId: string,
): Promise<void> {
  // A category id from another household must never be usable here -- see
  // the identical guard in lib/db/rules.ts createRule for why.
  if (!(await categoryBelongsToHousehold(exec, householdId, categoryId))) {
    throw new Error('UNKNOWN_CATEGORY')
  }

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
  // A category id from another household must never be usable here -- see
  // the identical guard in lib/db/rules.ts createRule for why.
  if (!(await categoryBelongsToHousehold(exec, householdId, categoryId))) {
    throw new Error('UNKNOWN_CATEGORY')
  }

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
