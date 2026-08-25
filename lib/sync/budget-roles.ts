import { eq, inArray } from 'drizzle-orm'
import type { Executor } from '@/lib/db/client'
import { accounts, categories, connections, transactions } from '@/lib/db/schema'
import { type BudgetRole, resolveBudgetRole } from '@/lib/domain/budget-role'

/**
 * Brings `budget_role` into line with the household's transactions.
 *
 * This is deliberately NOT part of recategorize. That function excludes
 * MANUAL rows in its query predicate -- the guarantee Slice 2 exists to make
 * -- but whether a row is an invoice payment or a salary has nothing to do
 * with who set its category. A hand-categorized invoice payment must still be
 * excluded, so this pass has no MANUAL exclusion at all.
 *
 * It also moves rows back: a row whose category stopped being an exclusion
 * becomes spending again. That is what makes it safe to run nightly rather
 * than once, and what lets a corrected rule land without a migration -- which
 * is exactly how a checking account full of invisible PIX gets repaired.
 *
 * Computed in TypeScript rather than as SQL predicates, unlike the version
 * this replaces. The rule now turns on the ACCOUNT TYPE and the DIRECTION of
 * the money, not on the category string alone: Pluggy labels a card
 * settlement and an outgoing PIX identically. Restating that in SQL would put
 * a second copy of a rule with real subtleties beside the one the ingest path
 * uses, and the two would drift.
 *
 * It reads the row's CATEGORY too, because a household can now file a fatura
 * payment under a TRANSFER category to force it out of every total -- a payment
 * Pluggy tagged 'Transfers' on a bank account, which direction alone would keep
 * as SPEND. resolveBudgetRole lets that filing win. Because this pass
 * re-derives every row from the live category, moving a payment back to an
 * ordinary category returns it to SPEND on the next run with no migration --
 * the same self-healing the role pass already had. This is why reconcileAll now
 * runs recategorize BEFORE this pass: a rule that files rows under the
 * card-payment category must be reflected here the same night.
 */
export async function refreshBudgetRoles(
  exec: Executor,
  householdId: string,
): Promise<{ changed: number }> {
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
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(eq(connections.householdId, householdId))

  // Grouped by target role so one UPDATE covers every row moving to it, rather
  // than one statement per transaction across a three-year history.
  const byRole = new Map<BudgetRole, string[]>()
  for (const row of rows) {
    const role = resolveBudgetRole(row.categoryGroup ?? null, row.pluggyCategory, {
      accountType: row.accountType,
      amountCents: row.amountCents,
    })
    // Only rows whose stored role is actually wrong, so a nightly no-op costs
    // no writes and the returned count is honest.
    if (role === row.budgetRole) continue
    byRole.set(role, [...(byRole.get(role) ?? []), row.id])
  }

  let changed = 0
  for (const [role, ids] of byRole) {
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500)
      await exec
        .update(transactions)
        .set({ budgetRole: role, updatedAt: new Date() })
        .where(inArray(transactions.id, slice))
      changed += slice.length
    }
  }

  return { changed }
}
