import { eq, inArray } from 'drizzle-orm'
import type { Executor } from '@/lib/db/client'
import { accounts, categories, connections, transactions } from '@/lib/db/schema'
import { type BudgetRole, resolveBudgetRole } from '@/lib/domain/budget-role'
import { pairedBankPaymentIds } from '@/lib/domain/card-payments'

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
 *
 * It also does what no per-row rule can: it PAIRS the bank leg of a fatura
 * payment to the card settlement it pays and forces it TRANSFER without the
 * household filing anything (lib/domain/card-payments.ts). That is a fact about
 * two rows -- a bank debit equal and opposite to a 'Credit card payment' on a
 * connected card the same day -- so it belongs here, in the one pass that sees
 * the whole household at once, not in classifyRole, which sees a row alone. It
 * self-heals like everything else: delete the card settlement and the bank leg
 * pairs with nothing and returns to SPEND on the next run. An unlinked card is
 * untouched by construction -- it has no settlement to pair against -- so a
 * payment that is the only record of its spending stays counted.
 */
export async function refreshBudgetRoles(
  exec: Executor,
  householdId: string,
): Promise<{ changed: number }> {
  const rows = await exec
    .select({
      id: transactions.id,
      date: transactions.date,
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

  // The bank legs of fatura payments, paired to the card settlements they pay.
  // Household-wide because the proof of a payment is a row on a DIFFERENT
  // account. A row's own category still wins over this -- filing it elsewhere is
  // the household overriding the pairing -- so it is only consulted as a
  // fallback below, after resolveBudgetRole.
  const pairedBankLegs = pairedBankPaymentIds(rows)

  // Grouped by target role so one UPDATE covers every row moving to it, rather
  // than one statement per transaction across a three-year history.
  const byRole = new Map<BudgetRole, string[]>()
  for (const row of rows) {
    const resolved = resolveBudgetRole(row.categoryGroup ?? null, row.pluggyCategory, {
      accountType: row.accountType,
      amountCents: row.amountCents,
    })
    // Pairing forces TRANSFER only where the household has not already spoken.
    // resolveBudgetRole returns TRANSFER when a TRANSFER category is filed and
    // INCOME/SPEND when any other category is -- and a payment the household
    // deliberately filed as a real expense (a rare split, a disputed charge)
    // must keep that filing. So the pairing applies only to rows still on their
    // default SPEND, never overriding a resolved INCOME or a filed category.
    const role =
      resolved === 'SPEND' && row.categoryGroup == null && pairedBankLegs.has(row.id)
        ? 'TRANSFER'
        : resolved
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
