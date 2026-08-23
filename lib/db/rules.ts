import { and, asc, eq } from 'drizzle-orm'
import { normalizeMerchant } from '@/lib/domain/categorize'
import { recategorize } from '@/lib/sync/categorize'
import { categoryBelongsToHousehold } from './categories'
import type { Db, Executor } from './client'
import { categories, merchantRules } from './schema'

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
}

export async function listRules(exec: Executor, householdId: string): Promise<RuleRow[]> {
  const rows = await exec
    .select({ rule: merchantRules, categoryName: categories.name })
    .from(merchantRules)
    .innerJoin(categories, eq(merchantRules.categoryId, categories.id))
    .where(eq(merchantRules.householdId, householdId))
    .orderBy(asc(merchantRules.priority), asc(merchantRules.pattern))

  return rows.map(({ rule, categoryName }) => ({
    id: rule.id,
    matchType: rule.matchType,
    pattern: rule.pattern,
    priority: rule.priority,
    categoryId: rule.categoryId,
    categoryName,
  }))
}

export type CreateRuleInput = {
  matchType: 'EXACT' | 'CONTAINS'
  pattern: string
  categoryId: string
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

  return db.transaction(async (tx) => {
    // A category id from another household must never be usable here: it
    // would insert successfully against the global FK and then recategorize
    // this household's transactions into a category that renders on the
    // ledger and that Slice 3's budgets key off of.
    if (!(await categoryBelongsToHousehold(tx, householdId, input.categoryId))) {
      throw new Error('UNKNOWN_CATEGORY')
    }

    const [rule] = await tx
      .insert(merchantRules)
      .values({
        householdId,
        matchType: input.matchType,
        pattern,
        categoryId: input.categoryId,
        priority,
      })
      .returning({ id: merchantRules.id })

    const { changed } = await recategorize(tx, {
      householdId,
      match: { matchType: input.matchType, pattern },
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
      .select({ matchType: merchantRules.matchType, pattern: merchantRules.pattern })
      .from(merchantRules)
      .where(and(eq(merchantRules.id, ruleId), eq(merchantRules.householdId, householdId)))
      .limit(1)

    if (!rule) return { changed: 0 }

    await tx
      .delete(merchantRules)
      .where(and(eq(merchantRules.id, ruleId), eq(merchantRules.householdId, householdId)))

    // Recategorizing what the deleted rule used to match is what makes
    // removing a bad rule undo it, rather than leaving stale assignments.
    return recategorize(tx, {
      householdId,
      match: { matchType: rule.matchType, pattern: rule.pattern },
    })
  })
}
