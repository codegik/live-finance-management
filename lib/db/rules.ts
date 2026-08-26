import { and, asc, eq } from 'drizzle-orm'
import { normalizeMerchant } from '@/lib/domain/categorize'
import { normalizedSeedRules } from '@/lib/domain/seed-rules'
import { recategorize } from '@/lib/sync/categorize'
import { categoryBelongsToHousehold } from './categories'
import { connectionBelongsToHousehold } from './connections'
import type { Db, Executor } from './client'
import { categories, connections, merchantRules } from './schema'

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
