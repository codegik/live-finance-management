import { and, desc, eq, gte, lte } from 'drizzle-orm'
import type { Db } from './client'
import { accounts, connections, transactions } from './schema'

export type TransactionRow = {
  id: string
  pluggyTransactionId: string
  date: string
  amountCents: number
  description: string
  merchantRaw: string | null
  pluggyCategory: string | null
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
    .orderBy(desc(transactions.date), desc(transactions.createdAt))

  return rows.map(({ transaction, account, connection }) => ({
    id: transaction.id,
    pluggyTransactionId: transaction.pluggyTransactionId,
    date: transaction.date,
    amountCents: transaction.amountCents,
    description: transaction.description,
    merchantRaw: transaction.merchantRaw,
    pluggyCategory: transaction.pluggyCategory,
    accountName: account.name,
    accountLast4: account.last4,
    institution: connection.institution,
    ownerUserId: connection.ownerUserId,
  }))
}
