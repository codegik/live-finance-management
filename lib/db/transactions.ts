import { and, count, desc, eq, gte, ilike, inArray, isNull, lte, or, type SQL, sql } from 'drizzle-orm'
import { type BudgetRole, resolveBudgetRole } from '@/lib/domain/budget-role'
import { categoryBelongsToHousehold } from './categories'
import type { Db, Executor } from './client'
import { escapeLike } from './like'
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
  budgetRole: BudgetRole
  installmentNumber: number | null
  installmentTotal: number | null
  /** An authorization the bank has not settled yet. See transaction.pending. */
  pending: boolean
  accountName: string
  accountLast4: string | null
  institution: string
  ownerUserId: string
}

type ListOpts = {
  from?: string
  to?: string
  includeExcluded?: boolean
  search?: string | null
}

/**
 * The WHERE for a household's transactions, shared by listTransactions and
 * countTransactions so a paginated page and its total can never disagree about
 * which rows are in scope. Every filter here references only transactions and
 * connections columns, so both callers can build the same joins around it.
 */
function transactionFilters(householdId: string, opts: ListOpts): SQL[] {
  const filters = [eq(connections.householdId, householdId)]
  if (opts.from) filters.push(gte(transactions.date, opts.from))
  if (opts.to) filters.push(lte(transactions.date, opts.to))
  // Invoice payments, fees and income are not spending. Callers that want
  // them -- the ledger's "show everything" toggle -- ask explicitly.
  if (!opts.includeExcluded) filters.push(eq(transactions.budgetRole, 'SPEND'))

  // Filtering in SQL rather than over the returned rows is what keeps the
  // ledger's per-day totals honest: those are summed from whatever this
  // returns, so a list filtered afterwards would sit under day headers still
  // totalling the unfiltered day.
  //
  // Two columns, because they answer different guesses at the same shop. The
  // description is what the bank printed, terminal ids and instalment
  // suffixes included; merchant_normalized is that with the noise stripped
  // and folded to upper case, so `mercadolivre merca` finds a row whose
  // description spells it `MERCADOLIVRE*MERCA 02/10`. ilike, not lower() +
  // like: neither column's casing can be assumed by the caller.
  const search = opts.search?.trim()
  if (search) {
    // escapeLike, not the bare string: see lib/db/like.ts for what a stray
    // '%' typed into the search box would otherwise match.
    const pattern = `%${escapeLike(search)}%`
    const anyColumn = or(
      ilike(transactions.description, pattern),
      ilike(transactions.merchantNormalized, pattern),
    )
    // or() is only undefined for an empty condition list; the guard is for
    // the type, not for a case that can happen.
    if (anyColumn) filters.push(anyColumn)
  }

  return filters
}

export async function listTransactions(
  db: Db,
  householdId: string,
  opts: ListOpts & { limit?: number; offset?: number } = {},
): Promise<TransactionRow[]> {
  const filters = transactionFilters(householdId, opts)

  const query = db
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
    // The same three keys order both the page and the count's OFFSET, so a row
    // can never fall between two pages or be served on both.
    .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
    .$dynamic()

  // limit/offset are opt-in: an unpaginated caller (the month and year views)
  // still gets every matching row, exactly as before.
  const rows = await (opts.limit === undefined
    ? query
    : query.limit(opts.limit).offset(opts.offset ?? 0))

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
    budgetRole: transaction.budgetRole,
    installmentNumber: transaction.installmentNumber,
    installmentTotal: transaction.installmentTotal,
    pending: transaction.pending,
    accountName: account.name,
    accountLast4: account.last4,
    institution: connection.institution,
    ownerUserId: connection.ownerUserId,
  }))
}

/**
 * How many transactions match the same filters listTransactions would page
 * over, and their summed amount. The count is what lets the ledger say "página
 * 2 de 9" and size its next button honestly; the sum is the grand total the
 * search summary shows, which before pagination was got by adding up every
 * loaded row and now has to be asked for directly. Both share
 * transactionFilters with the list, so the totals and the pages can never
 * describe different sets of rows.
 */
export async function aggregateTransactions(
  db: Db,
  householdId: string,
  opts: ListOpts = {},
): Promise<{ count: number; totalCents: number }> {
  const filters = transactionFilters(householdId, opts)

  const [row] = await db
    .select({
      count: count(),
      // coalesce: sum() over zero matching rows is SQL NULL, not 0. Number()
      // because Postgres returns the sum as a string -- safe here, amounts are
      // cents and a household's statement never nears 2^53 of them.
      totalCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::bigint`.mapWith(Number),
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(and(...filters))

  return { count: row?.count ?? 0, totalCents: row?.totalCents ?? 0 }
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
 * Re-derives budget_role for rows whose category just changed, in the same
 * edit.
 *
 * Filing a row under the TRANSFER category ('Pagamento de cartão') has to take
 * it out of every total at once, not only at the next nightly reconcile -- the
 * household categorizes a fatura payment precisely to watch Despesas drop.
 * Moving it back to an ordinary category returns it to its direction-derived
 * role in the same edit. This calls resolveBudgetRole, the exact decision the
 * nightly refreshBudgetRoles pass makes, so the inline edit and the batch pass
 * can never disagree about the same row.
 */
export async function refreshRolesForTransactions(
  exec: Executor,
  householdId: string,
  transactionIds: string[],
): Promise<void> {
  if (transactionIds.length === 0) return

  const rows = await exec
    .select({
      id: transactions.id,
      pluggyCategory: transactions.pluggyCategory,
      amountCents: transactions.amountCents,
      budgetRole: transactions.budgetRole,
      accountType: accounts.type,
      categoryGroup: categories.group,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        inArray(transactions.id, transactionIds),
        inArray(transactions.id, householdTransactionIds(exec, householdId)),
      ),
    )

  for (const row of rows) {
    const role = resolveBudgetRole(row.categoryGroup ?? null, row.pluggyCategory, {
      accountType: row.accountType,
      amountCents: row.amountCents,
    })
    if (role === row.budgetRole) continue
    await exec
      .update(transactions)
      .set({ budgetRole: role, updatedAt: new Date() })
      .where(eq(transactions.id, row.id))
  }
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

  // Filing under a TRANSFER category must drop the row from the totals now, not
  // at the next reconcile. See refreshRolesForTransactions.
  await refreshRolesForTransactions(exec, householdId, [transactionId])
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

  // Filing under a TRANSFER category must drop these rows from the totals now,
  // not at the next reconcile. See refreshRolesForTransactions.
  await refreshRolesForTransactions(
    exec,
    householdId,
    rows.map((row) => row.id),
  )

  return { changed: rows.length }
}
