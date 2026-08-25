/**
 * What a transaction is, for budgeting purposes.
 *
 * SPEND is the default and the fallback. An unrecognised category is NOT an
 * exclusion: a transaction Pluggy could not categorize belongs in the inbox,
 * where it is visible, rather than being silently dropped from every figure.
 *
 * 'Credit card payment' is the one string that must NEVER count, on either
 * side. VERIFIED AGAINST REAL DATA: on a live card it covers R$177,174.79 of
 * paid invoices, which appear on the card as credits. Card purchases are
 * already counted in the month their fatura falls due (lib/domain/billing.ts),
 * so counting the payment that settles it would count every card purchase a
 * second time.
 *
 * 'Transfers' is the string that made a connected checking account look empty,
 * and it is why this function takes the account and the direction rather than
 * the category alone. On a CARD a transfer is a settlement. On CHECKING it is a
 * PIX or a TED -- money genuinely leaving for a person or a service, or
 * genuinely arriving -- and excluding it made every PIX invisible in a
 * household that pays for most things by PIX.
 *
 * ON A BANK ACCOUNT, DIRECTION ALONE DECIDES. This is the part that was wrong
 * when only 'Transfers' was read directionally, and it was not merely a missing
 * row: money arriving is stored as NEGATIVE centavos (lib/domain/money.ts), so
 * an arriving credit filed as SPEND does not go missing, it SUBTRACTS itself
 * from that month's Despesas. A received PIX of R$77.000 silently made the
 * month's expense figure R$77.000 too low, and nothing on any screen said so.
 *
 * VERIFIED AGAINST REAL DATA, on a live Nubank checking sync, the strings
 * Pluggy actually put on money ARRIVING in the account:
 *
 *   'Transfers'             77 rows, R$670,725.90 -- a received PIX, which is
 *                           what "Transferência recebida / Pix" comes through
 *                           as. This is the one the old rule got right.
 *   'Investments'           43 rows, R$87,337.95  -- a redemption landing back
 *                           in checking. NOT 'Investment redemption'.
 *   'Same person transfer'   2 rows, R$6,900.00   -- the household's own money
 *                           arriving from another of its accounts.
 *   'Third party transfers' 12 rows, R$13.27      -- someone paying the
 *                           household back.
 *   null                     4 rows               -- a bonus/PLR/one-off sale
 *                           that Pluggy did not categorize at all.
 *
 * Only the first was in any list. The other four fell through to SPEND, and
 * across this household's three years they were subtracting R$155,256.99 from
 * Despesas -- R$5,001.17 of it in August 2026 alone. Enumerating strings could
 * never have been safe here: the failure mode of a missing string is a wrong
 * expense total, not a visible gap, and Pluggy is free to add another tomorrow.
 * Direction is a fact about the row; the category string is a guess about it.
 *
 * ON A CARD, A CREDIT MUST STAY SPEND. There it is an estorno -- a reversed
 * purchase -- and leaving it as SPEND is exactly right: it reduces the category
 * it originally charged. Reading card credits as income would turn every
 * refunded purchase into household earnings. This is why the rule branches on
 * account type before it looks at direction at all.
 *
 * The cost of "arriving means income" on checking is deliberate and bounded.
 * An own-account transfer between two connected accounts is now counted on both
 * legs: SPEND leaving one, INCOME arriving at the other. That inflates Receita
 * and Despesas by the same amount and leaves `netCents` correct, and both legs
 * stay visible and recategorizable. The alternative -- leaving the arriving leg
 * as a negative SPEND -- corrupts a category the household never spent on, and
 * corrupts it invisibly. An overstatement you can see beats an understatement
 * you cannot.
 *
 * IOF and card fees ('Tax on financial operations', 'Credit card fees') are no
 * longer excluded either. They were called "bank charges, not a household
 * budget line", but they are charged on the fatura and leave the account like
 * anything else -- excluding them made the app read below the card statement
 * for no reason the household could see.
 *
 * The income strings are now only consulted on a CARD: on a bank account the
 * direction answers first and answers better. They remain UNVERIFIED -- they
 * come from Pluggy's published taxonomy, and note that the live checking sync
 * above produced 'Investments' where the taxonomy promises 'Investment
 * redemption', which is precisely why nothing on a bank account depends on
 * them any more.
 *
 * BOTH SETS ARE DUPLICATED IN SQL. drizzle/0006_budgets.sql backfills the
 * transfer rows and drizzle/0009_budget_role.sql backfills the income rows,
 * because the nightly refreshBudgetRoles pass is up to 24 hours away at
 * deploy time and every figure is wrong until it runs. Adding a category here
 * corrects new and re-synced rows only -- rows already in the database need a
 * new migration. tests/budget-role.test.ts asserts the lists and the SQL
 * agree, so a silent divergence fails the suite rather than the household's
 * totals.
 *
 * THE BANK DIRECTION RULE HAS NO SQL COUNTERPART, deliberately. Those two
 * migrations back-fill by category string, and the whole point of this rule is
 * that no list of strings is ever complete. lib/sync/budget-roles.ts now
 * re-derives every row through this function instead of restating predicates
 * in SQL, so an existing database is repaired by the next refreshBudgetRoles
 * pass rather than by a migration -- which is what makes a corrected rule
 * reach three years of already-stored rows at all. Until that pass runs, the
 * stored roles are whatever the previous rule decided.
 */
export type BudgetRole = 'SPEND' | 'TRANSFER' | 'INCOME'

/**
 * Never counted, whichever account it lands on and whichever way it points.
 * Kept as a set rather than a single string so the SQL-agreement tests below
 * keep working, and because a second such string is plausible.
 */
export const TRANSFER_PLUGGY_CATEGORIES: ReadonlySet<string> = new Set(['Credit card payment'])

/**
 * Money moving on a CARD statement, which is the card settling rather than the
 * household spending.
 *
 * Consulted only when the row sits on a CREDIT account. A bank account never
 * reaches this set: there, direction decides for every string and for no string
 * at all, which is the whole point of the note above.
 */
export const CARD_TRANSFER_CATEGORIES: ReadonlySet<string> = new Set(['Transfers'])

export const INCOME_PLUGGY_CATEGORIES: ReadonlySet<string> = new Set([
  'Salary',
  'Retirement',
  'Interest income',
  'Investment redemption',
])

/**
 * What the row sits on and which way the money went.
 *
 * Centavos are positive for money out and negative for money in
 * (lib/domain/money.ts), which is what makes direction readable here.
 */
export type RoleContext = {
  accountType: 'CREDIT' | 'BANK'
  amountCents: number
}

export function classifyRole(
  pluggyCategory: string | null | undefined,
  context: RoleContext,
): BudgetRole {
  // Both sides of an invoice payment, always, on either account and in either
  // direction. Nothing below may override it: the money leaving checking and
  // the credit landing on the card are the same money, and it was already
  // counted purchase by purchase.
  if (pluggyCategory && TRANSFER_PLUGGY_CATEGORIES.has(pluggyCategory)) return 'TRANSFER'

  if (context.accountType === 'BANK') {
    // Direction is the whole answer here, and it is answered before any
    // category string is read. A string-driven rule can only ever be as
    // complete as the strings someone thought to list, and every string it
    // misses becomes a negative SPEND -- an expense total quietly reduced by
    // money that arrived. See the observed strings in the note above.
    //
    // Zero is money that moved nowhere; it falls to SPEND so it stays in the
    // inbox rather than inventing a R$0,00 income row.
    return context.amountCents < 0 ? 'INCOME' : 'SPEND'
  }

  // Everything below is a CREDIT account.
  if (!pluggyCategory) return 'SPEND'
  if (INCOME_PLUGGY_CATEGORIES.has(pluggyCategory)) return 'INCOME'
  if (CARD_TRANSFER_CATEGORIES.has(pluggyCategory)) return 'TRANSFER'

  // A credit on a card is an estorno, and SPEND is what makes it reduce the
  // category it reverses. Reading it as income would turn every refund into
  // household earnings.
  return 'SPEND'
}
