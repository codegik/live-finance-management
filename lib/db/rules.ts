import { and, asc, count, desc, eq, like } from 'drizzle-orm'
import { normalizeMerchant } from '@/lib/domain/categorize'
import { normalizedSeedRules } from '@/lib/domain/seed-rules'
import { recategorize } from '@/lib/sync/categorize'
import { categoryBelongsToHousehold } from './categories'
import { connectionBelongsToHousehold } from './connections'
import type { Db, Executor } from './client'
import { escapeLike } from './like'
import { accounts, categories, connections, merchantRules, transactions } from './schema'

/** Inbox-created rules match one exact merchant, so they win by default. */
export const DEFAULT_EXACT_PRIORITY = 100
/** Hand-written substring rules are broader, so they lose ties by default. */
export const DEFAULT_CONTAINS_PRIORITY = 200

export type RuleRow = {
  id: string
  matchType: 'EXACT' | 'CONTAINS'
  pattern: string
  priority: number
  categoryId: string
  categoryName: string
  // The bank this rule is pinned to, or null when it applies to every bank.
  connectionId: string | null
  institution: string | null
}

export async function listRules(exec: Executor, householdId: string): Promise<RuleRow[]> {
  const rows = await exec
    .select({
      rule: merchantRules,
      categoryName: categories.name,
      // Left join: a rule with no bank scope has no connection row, so its
      // institution comes back null rather than dropping the rule.
      institution: connections.institution,
    })
    .from(merchantRules)
    .innerJoin(categories, eq(merchantRules.categoryId, categories.id))
    .leftJoin(connections, eq(merchantRules.connectionId, connections.id))
    .where(eq(merchantRules.householdId, householdId))
    .orderBy(asc(merchantRules.priority), asc(merchantRules.pattern))

  return rows.map(({ rule, categoryName, institution }) => ({
    id: rule.id,
    matchType: rule.matchType,
    pattern: rule.pattern,
    priority: rule.priority,
    categoryId: rule.categoryId,
    categoryName,
    connectionId: rule.connectionId,
    institution,
  }))
}

export type RulePreviewItem = {
  id: string
  date: string
  description: string
  amountCents: number
  institution: string
  /** The category the transaction sits in now, before the rule is saved. */
  categoryName: string | null
}

export type RulePreviewMatch = {
  matchType: 'EXACT' | 'CONTAINS'
  pattern: string
  /** Bank scope. Null/undefined previews across every bank. */
  connectionId?: string | null
}

/**
 * The transactions a rule WOULD catch, for the live preview under the form --
 * so the household sees the blast radius before saving, not the "14
 * recategorized" count after.
 *
 * It matches merchant_normalized exactly the way recategorize() does (same
 * normalize, same EXACT/CONTAINS split, same optional bank scope), so the
 * preview cannot promise a match the save would then miss. It deliberately
 * does NOT exclude already-categorized or MANUAL rows: the question the panel
 * answers is "which transactions does this pattern name", and a row already in
 * the right category is still one the household wants to see it caught. The
 * current category rides along so an about-to-change row is visible as such.
 */
export async function previewRuleMatches(
  exec: Executor,
  householdId: string,
  match: RulePreviewMatch,
  limit = 8,
): Promise<{ total: number; items: RulePreviewItem[] }> {
  // Same normalization the stored pattern gets: an un-normalized needle would
  // never match the normalized merchant column. A pattern that normalizes to
  // nothing (punctuation only) matches nothing, exactly as createRule rejects.
  const pattern = normalizeMerchant(match.pattern)
  if (!pattern) return { total: 0, items: [] }

  const where = and(
    eq(connections.householdId, householdId),
    match.matchType === 'EXACT'
      ? eq(transactions.merchantNormalized, pattern)
      : like(transactions.merchantNormalized, `%${escapeLike(pattern)}%`),
    // A falsy connectionId is "any bank"; only a real one narrows the scope.
    ...(match.connectionId ? [eq(accounts.connectionId, match.connectionId)] : []),
  )

  const [countRow] = await exec
    .select({ value: count() })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(where)

  const items = await exec
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amountCents: transactions.amountCents,
      institution: connections.institution,
      categoryName: categories.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    // Left, not inner: an uncategorized match must still appear -- those are
    // the very rows a rule most often exists to file.
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit)

  return { total: countRow?.value ?? 0, items }
}

export type CreateRuleInput = {
  matchType: 'EXACT' | 'CONTAINS'
  pattern: string
  categoryId: string
  // Optional bank scope. Null/undefined creates a rule matching every bank.
  connectionId?: string | null
  priority?: number
}

/**
 * Writes the rule and backfills its transactions in one database
 * transaction. Splitting them would allow a failed backfill to leave a rule
 * that applied to only part of its own history — a state nothing later would
 * detect or repair.
 */
export async function createRule(
  db: Db,
  householdId: string,
  input: CreateRuleInput,
): Promise<{ ruleId: string; changed: number }> {
  // Patterns are stored normalized so matching needs no normalization at
  // query time and is symmetrical with the transaction side.
  const pattern = normalizeMerchant(input.pattern)
  if (!pattern) throw new Error('EMPTY_PATTERN')

  const priority =
    input.priority ??
    (input.matchType === 'EXACT' ? DEFAULT_EXACT_PRIORITY : DEFAULT_CONTAINS_PRIORITY)

  // Normalize away an empty bank selection so "any bank" is always null,
  // never the empty string a form submits.
  const connectionId = input.connectionId || null

  return db.transaction(async (tx) => {
    // A category id from another household must never be usable here: it
    // would insert successfully against the global FK and then recategorize
    // this household's transactions into a category that renders on the
    // ledger and that Slice 3's budgets key off of.
    if (!(await categoryBelongsToHousehold(tx, householdId, input.categoryId))) {
      throw new Error('UNKNOWN_CATEGORY')
    }

    // Same reasoning for the bank scope: a connection id from another
    // household would pass the global FK yet scope this rule to a bank the
    // household does not own -- so it must match nothing rather than insert.
    if (connectionId && !(await connectionBelongsToHousehold(tx, householdId, connectionId))) {
      throw new Error('UNKNOWN_CONNECTION')
    }

    const [rule] = await tx
      .insert(merchantRules)
      .values({
        householdId,
        matchType: input.matchType,
        pattern,
        categoryId: input.categoryId,
        connectionId,
        priority,
      })
      .returning({ id: merchantRules.id })

    const { changed } = await recategorize(tx, {
      householdId,
      match: { matchType: input.matchType, pattern, connectionId },
    })

    return { ruleId: rule.id, changed }
  })
}

export async function deleteRule(
  db: Db,
  householdId: string,
  ruleId: string,
): Promise<{ changed: number }> {
  return db.transaction(async (tx) => {
    const [rule] = await tx
      .select({
        matchType: merchantRules.matchType,
        pattern: merchantRules.pattern,
        connectionId: merchantRules.connectionId,
      })
      .from(merchantRules)
      .where(and(eq(merchantRules.id, ruleId), eq(merchantRules.householdId, householdId)))
      .limit(1)

    if (!rule) return { changed: 0 }

    await tx
      .delete(merchantRules)
      .where(and(eq(merchantRules.id, ruleId), eq(merchantRules.householdId, householdId)))

    // Recategorizing what the deleted rule used to match is what makes
    // removing a bad rule undo it, rather than leaving stale assignments. A
    // bank-scoped rule only touched its own bank, so the undo carries the
    // same scope.
    return recategorize(tx, {
      householdId,
      match: { matchType: rule.matchType, pattern: rule.pattern, connectionId: rule.connectionId },
    })
  })
}

/**
 * Creates the household's default merchant rules, skipping any that already
 * exist. Idempotent against the (household_id, match_type, pattern) unique
 * index, so it is safe to run on every nightly reconcile.
 *
 * Unlike createRule this does NOT backfill: the only callers are household
 * creation (where there is nothing to backfill) and reconcileAll, which runs
 * a household-wide recategorize immediately afterwards.
 *
 * A seed rule naming a seed key the household has archived or deleted is
 * skipped rather than failing -- the household's taxonomy is theirs to edit,
 * and a default rule is not a reason to reject the whole run.
 */
export async function seedDefaultRules(exec: Executor, householdId: string): Promise<void> {
  const owned = await exec
    .select({ id: categories.id, seedKey: categories.seedKey })
    .from(categories)
    .where(eq(categories.householdId, householdId))

  const idBySeedKey = new Map(
    owned.flatMap((c) => (c.seedKey ? [[c.seedKey, c.id] as const] : [])),
  )

  const values = normalizedSeedRules().flatMap((rule) => {
    const categoryId = idBySeedKey.get(rule.seedKey)
    if (!categoryId) return []
    return [{
      householdId,
      matchType: rule.matchType,
      pattern: rule.pattern,
      categoryId,
      priority:
        rule.matchType === 'EXACT' ? DEFAULT_EXACT_PRIORITY : DEFAULT_CONTAINS_PRIORITY,
    }]
  })

  if (values.length === 0) return
  await exec.insert(merchantRules).values(values).onConflictDoNothing()
}
