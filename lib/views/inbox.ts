import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { listCategories } from '@/lib/db/categories'
import type { Db, Executor } from '@/lib/db/client'
import { accounts, connections, transactions } from '@/lib/db/schema'

/** One uncategorized row, as the group's detail list shows it. */
export type InboxTransaction = {
  id: string
  date: string
  amountCents: number
  description: string
  accountName: string
  last4: string | null
}

export type InboxGroup = {
  merchant: string | null
  count: number
  totalCents: number
  sampleDescription: string
  latestDate: string
  /**
   * The rows behind `count` and `totalCents`.
   *
   * Capped at DETAIL_LIMIT: the group header is an aggregate over every
   * matching row, so a household with a thousand rows on one merchant would
   * otherwise ship a thousand of them to the browser to render a list nobody
   * scrolls. `count` still reports the true total, and the screen says so when
   * the list is shorter -- a truncated list presented as complete is how
   * someone concludes the count is wrong.
   */
  transactions: InboxTransaction[]
}

export type InboxView = {
  groups: InboxGroup[]
  totalCount: number
  categories: { id: string; name: string }[]
}

/** How many rows of a single merchant the detail list will carry. */
const DETAIL_LIMIT = 100

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
  const [rows, detail, categories] = await Promise.all([
    householdUncategorized(db, householdId),
    // The individual rows, in one query rather than one per group: the groups
    // are already the whole uncategorized set, so this reads the same rows the
    // aggregate above just counted.
    db
      .select({
        id: transactions.id,
        merchant: transactions.merchantNormalized,
        date: transactions.date,
        amountCents: transactions.amountCents,
        description: transactions.description,
        accountName: accounts.name,
        last4: accounts.last4,
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
      .orderBy(desc(transactions.date), desc(transactions.id)),
    listCategories(db, householdId),
  ])

  // Keyed the same way the aggregate groups: on merchant_normalized, null
  // included, so the "no usable merchant" bucket keeps its rows too.
  const byMerchant = new Map<string, InboxTransaction[]>()
  for (const row of detail) {
    const key = row.merchant ?? ''
    const list = byMerchant.get(key) ?? []
    if (list.length < DETAIL_LIMIT) {
      list.push({
        id: row.id,
        date: row.date,
        amountCents: row.amountCents,
        description: row.description,
        accountName: row.accountName,
        last4: row.last4,
      })
    }
    byMerchant.set(key, list)
  }

  const groups = rows.map((row) => ({
    merchant: row.merchant,
    count: Number(row.count),
    totalCents: Number(row.totalCents),
    sampleDescription: row.sampleDescription,
    latestDate: row.latestDate,
    transactions: byMerchant.get(row.merchant ?? '') ?? [],
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
