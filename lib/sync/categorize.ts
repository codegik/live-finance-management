import { and, eq, inArray, isNull, like, ne, or } from 'drizzle-orm'
import type { Executor } from '@/lib/db/client'
import { escapeLike } from '@/lib/db/like'
import { householdTransactionIds } from '@/lib/db/transactions'
import { categories, merchantRules, transactions } from '@/lib/db/schema'
import { normalizeMerchant, resolveCategory } from '@/lib/domain/categorize'

export type RecategorizeScope =
  | { householdId: string; transactionIds: string[] }
  | { householdId: string; match: { matchType: 'EXACT' | 'CONTAINS'; pattern: string } }
  | { householdId: string }

/**
 * The only code that computes a category from merchant, rule and Pluggy
 * inputs.
 *
 * Three callers — the sync (by transaction id), rule create and delete (by
 * what the rule matches), and the nightly reconcile (household-wide). One
 * decision function, one writer, so the sync path and the backfill path
 * cannot drift apart.
 *
 * MANUAL rows are excluded in the query predicate rather than filtered in
 * code, so the guarantee lives in one WHERE clause instead of being
 * remembered at three call sites. What that excludes is precisely the
 * *category*: a MANUAL row's category_id and category_source are never
 * recomputed by anything. Its merchant_normalized is a different matter —
 * lib/sync/transactions.ts includes merchantNormalized in its
 * onConflictDoUpdate set, so every sync refreshes it for all rows, MANUAL
 * ones included. That is harmless (it writes the freshly computed value) and
 * nothing depends on it for such a row: it is excluded from rule matching
 * and from the inbox alike.
 */
export async function recategorize(
  exec: Executor,
  scope: RecategorizeScope,
): Promise<{ changed: number }> {
  if ('transactionIds' in scope && scope.transactionIds.length === 0) {
    return { changed: 0 }
  }

  const active = await exec
    .select({ id: categories.id, seedKey: categories.seedKey })
    .from(categories)
    .where(and(eq(categories.householdId, scope.householdId), isNull(categories.archivedAt)))

  // Only non-archived categories reach the map, so an archived one falls
  // through to the inbox with no special case in the resolver.
  const categoryIdBySeedKey = new Map(
    active.flatMap((c) => (c.seedKey ? [[c.seedKey, c.id] as const] : [])),
  )

  const rules = await exec
    .select({
      id: merchantRules.id,
      matchType: merchantRules.matchType,
      pattern: merchantRules.pattern,
      categoryId: merchantRules.categoryId,
      priority: merchantRules.priority,
    })
    .from(merchantRules)
    .where(eq(merchantRules.householdId, scope.householdId))

  const filters = [
    inArray(transactions.id, householdTransactionIds(exec, scope.householdId)),
    or(isNull(transactions.categorySource), ne(transactions.categorySource, 'MANUAL'))!,
  ]

  if ('transactionIds' in scope) {
    filters.push(inArray(transactions.id, scope.transactionIds))
  } else if ('match' in scope) {
    // Scoped by what the rule matches, not by one merchant string: a
    // CONTAINS rule created from 'ZAFFARI PORTO ALEG' must also backfill
    // 'ZAFFARI CENTRO', which is the whole point of the match type.
    filters.push(
      scope.match.matchType === 'EXACT'
        ? eq(transactions.merchantNormalized, scope.match.pattern)
        : like(transactions.merchantNormalized, `%${escapeLike(scope.match.pattern)}%`),
    )
  }

  const rows = await exec
    .select({
      id: transactions.id,
      description: transactions.description,
      merchantRaw: transactions.merchantRaw,
      merchantNormalized: transactions.merchantNormalized,
      pluggyCategory: transactions.pluggyCategory,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
    })
    .from(transactions)
    .where(and(...filters))

  let changed = 0

  for (const row of rows) {
    const merchantNormalized = normalizeMerchant(row.merchantRaw ?? row.description)
    const next = resolveCategory(
      {
        merchantNormalized,
        pluggyCategory: row.pluggyCategory,
        categoryId: row.categoryId,
        categorySource: row.categorySource,
      },
      rules,
      categoryIdBySeedKey,
    )

    const unchanged =
      merchantNormalized === row.merchantNormalized &&
      next.categoryId === row.categoryId &&
      next.source === row.categorySource
    if (unchanged) continue

    await exec
      .update(transactions)
      .set({
        merchantNormalized,
        categoryId: next.categoryId,
        categorySource: next.source,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, row.id))

    changed += 1
  }

  return { changed }
}
