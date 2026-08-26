import { eq, inArray } from 'drizzle-orm'
import type { Executor } from '@/lib/db/client'
import { accounts, categories, connections, transactions } from '@/lib/db/schema'
import { pairedOwnTransferIds } from '@/lib/domain/account-transfers'
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
 *
 * It does the same for a transfer between the household's OWN bank accounts:
 * the debit that left one and the credit that arrived at another are the same
 * money, counted as SPEND on one side and INCOME on the other, and pairing them
 * on amount and date forces BOTH to TRANSFER (lib/domain/account-transfers.ts).
 * This override is wider than the card one -- it beats an AUTO category, not
 * only a defaulted SPEND -- because a transfer is routinely mis-tagged 'Casa' or
 * 'Renda extra' by a rule or by Pluggy, and only a MANUAL filing is left to win
 * over it. Where the legs are too far apart to pair, the household files either
 * under the 'Transferência entre contas' category and the same TRANSFER follows.
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
      accountId: transactions.accountId,
      accountType: accounts.type,
      categoryGroup: categories.group,
      categorySource: transactions.categorySource,
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

  // Both legs of every transfer between the household's OWN accounts -- the
  // debit that left one account and the credit that arrived at another. Same
  // reason it belongs here and not in classifyRole: it is a fact about two rows
  // on two accounts, visible only to the pass that sees the whole household.
  //
  // Two kinds of row are held out of the pairing. Card legs, so an outgoing
  // fatura payment is not also claimed here by a coincidental equal credit. And
  // any MANUALLY filed row: hiding is symmetric -- a pair is hidden on both legs
  // or neither -- so if the household insists ONE leg is real, excluding it
  // leaves its partner unpaired too, and both keep their natural roles rather
  // than one vanishing while the other counts and net drifts.
  // See lib/domain/account-transfers.ts.
  const excludeFromOwnPairing = new Set<string>(pairedBankLegs)
  for (const row of rows) {
    if (row.categorySource === 'MANUAL') excludeFromOwnPairing.add(row.id)
  }
  const pairedOwnTransfers = pairedOwnTransferIds(rows, { exclude: excludeFromOwnPairing })

  // Grouped by target role so one UPDATE covers every row moving to it, rather
  // than one statement per transaction across a three-year history.
  const byRole = new Map<BudgetRole, string[]>()
  for (const row of rows) {
    const resolved = resolveBudgetRole(row.categoryGroup ?? null, row.pluggyCategory, {
      accountType: row.accountType,
      amountCents: row.amountCents,
    })
    // The card-payment leg is the narrower rule it always was, unchanged: it
    // overrides only a defaulted SPEND with no category at all, so an
    // uncategorized bank debit that settles a connected card leaves the totals.
    // resolveBudgetRole returns TRANSFER when a TRANSFER category is filed and
    // INCOME/SPEND when any other is -- and a payment the household deliberately
    // filed as a real expense must keep that filing.
    //
    // The own-transfer legs are broader, and deliberately so: an outgoing leg
    // resolves SPEND and an arriving leg resolves INCOME, so BOTH must be
    // overridable, and Pluggy or a merchant rule routinely files a transfer
    // under an ordinary category ('Casa', 'Renda extra') that a per-row rule
    // cannot see through -- so this overrides an AUTO category too, which is what
    // lets a transfer already tagged 'Casa' drop out without the household
    // touching it. A MANUAL leg never reaches this set: it was held out of the
    // pairing above, so a hand-filed row keeps whatever role it was filed under.
    let role = resolved
    if (resolved === 'SPEND' && row.categoryGroup == null && pairedBankLegs.has(row.id)) {
      role = 'TRANSFER'
    } else if (pairedOwnTransfers.has(row.id)) {
      role = 'TRANSFER'
    }
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
