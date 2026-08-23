import { and, eq, isNull, sql } from 'drizzle-orm'
import { listCategories } from '@/lib/db/categories'
import type { Db, Executor } from '@/lib/db/client'
import { accounts, connections, transactions } from '@/lib/db/schema'

export type InboxGroup = {
  merchant: string | null
  count: number
  totalCents: number
  sampleDescription: string
  latestDate: string
}

export type InboxView = {
  groups: InboxGroup[]
  totalCount: number
  categories: { id: string; name: string }[]
}

function householdUncategorized(exec: Executor, householdId: string) {
  return exec
    .select({
      merchant: transactions.merchantNormalized,
      // count() and sum() come back as strings from the postgres driver;
      // Number() at the boundary keeps centavos integral in JS.
      count: sql<string>`count(*)`,
      totalCents: sql<string>`sum(${transactions.amountCents})`,
      latestDate: sql<string>`max(${transactions.date})`,
      sampleDescription: sql<string>`min(${transactions.description})`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(
      and(
        eq(connections.householdId, householdId),
        isNull(transactions.categoryId),
        eq(transactions.budgetRole, 'SPEND'),
      ),
    )
    .groupBy(transactions.merchantNormalized)
    .orderBy(sql`sum(${transactions.amountCents}) desc`)
}

export async function getInboxView(db: Db, householdId: string): Promise<InboxView> {
  const [rows, categories] = await Promise.all([
    householdUncategorized(db, householdId),
    listCategories(db, householdId),
  ])

  const groups = rows.map((row) => ({
    merchant: row.merchant,
    count: Number(row.count),
    totalCents: Number(row.totalCents),
    sampleDescription: row.sampleDescription,
    latestDate: row.latestDate,
  }))

  return {
    groups,
    totalCount: groups.reduce((sum, group) => sum + group.count, 0),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
  }
}

/** The ledger's badge. Cheap enough to run on every ledger render. */
export async function countUncategorized(exec: Executor, householdId: string): Promise<number> {
  const [row] = await exec
    .select({ value: sql<string>`count(*)` })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(
      and(
        eq(connections.householdId, householdId),
        isNull(transactions.categoryId),
        eq(transactions.budgetRole, 'SPEND'),
      ),
    )

  return Number(row?.value ?? 0)
}
