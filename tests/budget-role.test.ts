import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  classifyRole,
  INCOME_PLUGGY_CATEGORIES,
  TRANSFER_PLUGGY_CATEGORIES,
} from '@/lib/domain/budget-role'

/** Money out is positive centavos, money in negative. */
const cardOut = { accountType: 'CREDIT' as const, amountCents: 30_000 }
const bankOut = { accountType: 'BANK' as const, amountCents: 30_000 }
const bankIn = { accountType: 'BANK' as const, amountCents: -80_000 }

it('never counts an invoice payment, on either account or either direction', () => {
  // Card purchases are already counted in the month their fatura falls due, so
  // counting the payment that settles it counts every one of them twice. On a
  // live card this string alone covers R$177,174.79.
  expect(classifyRole('Credit card payment', cardOut)).toBe('TRANSFER')
  expect(classifyRole('Credit card payment', bankOut)).toBe('TRANSFER')
  expect(classifyRole('Credit card payment', { accountType: 'BANK', amountCents: -500 })).toBe(
    'TRANSFER',
  )
})

it('reads a transfer on checking by which way the money went', () => {
  // Pluggy labels an outgoing PIX and an arriving one with the same string,
  // and excluding both is what made a connected checking account look empty.
  expect(classifyRole('Transfers', bankOut)).toBe('SPEND')
  expect(classifyRole('Transfers', bankIn)).toBe('INCOME')
})

it('reads money arriving on checking as income whatever Pluggy called it', () => {
  // The regression this file exists for. A received PIX of R$77.000 from
  // Codegik Software Engineering Ltda came through as 'Transfers' and was
  // read correctly, but four other strings on the SAME live Nubank checking
  // account were not in any list and fell through to SPEND. Money in is
  // stored NEGATIVE (lib/domain/money.ts), so each one subtracted itself from
  // that month's Despesas rather than merely going missing -- R$155,256.99
  // across this household's history.
  //
  // VERIFIED AGAINST REAL DATA: every string below was observed on money
  // ARRIVING in a live Nubank checking account.
  for (const observed of [
    'Transfers', // 77 rows, R$670,725.90 -- a received PIX
    'Investments', // 43 rows, R$87,337.95 -- a redemption landing back
    'Same person transfer', // 2 rows, R$6,900.00 -- own money from another account
    'Third party transfers', // 12 rows, R$13.27 -- someone paying the household back
  ]) {
    expect(classifyRole(observed, bankIn)).toBe('INCOME')
  }

  // And the ones Pluggy did not categorize at all: a bonus, a PLR, a one-off
  // sale. Direction is a fact about the row; the category is a guess about it.
  expect(classifyRole(null, bankIn)).toBe('INCOME')
  expect(classifyRole(undefined, bankIn)).toBe('INCOME')
  expect(classifyRole('', bankIn)).toBe('INCOME')

  // A string nobody has ever seen, which is the point: the rule must not
  // depend on the list being complete.
  expect(classifyRole('Some Category Pluggy Invents In 2027', bankIn)).toBe('INCOME')
})

it('keeps a credit on a CARD as spend, because there it is an estorno', () => {
  // The asymmetry is the whole design. On checking an arriving credit is
  // salary; on a card it is a reversed purchase, and SPEND is what makes it
  // reduce the category it originally charged. Reading card credits as income
  // would turn every refund into household earnings.
  const cardCredit = { accountType: 'CREDIT' as const, amountCents: -30_000 }
  expect(classifyRole('Groceries', cardCredit)).toBe('SPEND')
  expect(classifyRole(null, cardCredit)).toBe('SPEND')
  expect(classifyRole('Third party transfers', cardCredit)).toBe('SPEND')
})

it('still treats a transfer on a card as a settlement', () => {
  // On a card statement a transfer is the card settling, not the household
  // spending.
  expect(classifyRole('Transfers', cardOut)).toBe('TRANSFER')
  expect(classifyRole('Transfers', { accountType: 'CREDIT', amountCents: -30_000 })).toBe(
    'TRANSFER',
  )
})

it('treats money that moved nowhere on checking as spend, not as income', () => {
  // A R$0,00 row is not earnings. SPEND keeps it in the inbox instead of
  // inventing an income row the household has to explain to itself.
  expect(classifyRole(null, { accountType: 'BANK', amountCents: 0 })).toBe('SPEND')
  expect(classifyRole('Transfers', { accountType: 'BANK', amountCents: 0 })).toBe('SPEND')
})

it('counts IOF and card fees, which are charged like anything else', () => {
  // Previously excluded as "bank charges, not a household budget line". They
  // are charged on the fatura and leave the account, and excluding them made
  // the app read below the card statement for no visible reason.
  expect(classifyRole('Tax on financial operations', cardOut)).toBe('SPEND')
  expect(classifyRole('Credit card fees', cardOut)).toBe('SPEND')
})

it('classifies money arriving as income', () => {
  for (const category of INCOME_PLUGGY_CATEGORIES) {
    expect(classifyRole(category, bankIn)).toBe('INCOME')
    // Asserted on a card too, because on checking the direction alone would
    // return INCOME whether the set existed or not -- a bank-only assertion
    // would keep passing if the set were emptied by accident.
    expect(classifyRole(category, { accountType: 'CREDIT', amountCents: -80_000 })).toBe('INCOME')
  }
  expect(INCOME_PLUGGY_CATEGORIES.size).toBeGreaterThan(0)
})

it('classifies ordinary spending as spending', () => {
  expect(classifyRole('Groceries', cardOut)).toBe('SPEND')
  expect(classifyRole('Eating out', cardOut)).toBe('SPEND')
  expect(classifyRole('Vehicle maintenance', cardOut)).toBe('SPEND')
})

it('treats an absent category as spending rather than guessing', () => {
  // A transaction Pluggy could not categorize belongs in the inbox, where it
  // is visible -- not silently excluded from every total.
  expect(classifyRole(null, cardOut)).toBe('SPEND')
  expect(classifyRole(undefined, cardOut)).toBe('SPEND')
  expect(classifyRole('', cardOut)).toBe('SPEND')
})

it('keeps income and transfer disjoint', () => {
  // Both exclude a row from the budget, but they are not interchangeable:
  // a string in both sets means classifyRole precedence decides silently.
  for (const category of INCOME_PLUGGY_CATEGORIES) {
    expect(TRANSFER_PLUGGY_CATEGORIES.has(category)).toBe(false)
  }
})

it('keeps the 0006 backfill in step with the transfer set it copies', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const sql = readFileSync(join(root, 'drizzle/0006_budgets.sql'), 'utf8')
  const backfill = sql.slice(sql.indexOf('UPDATE "transaction" SET "is_transfer" = true'))

  expect(backfill).not.toBe('')
  for (const category of TRANSFER_PLUGGY_CATEGORIES) {
    expect(backfill).toContain(`'${category}'`)
  }
})

it('keeps the 0009 backfill in step with the income set it copies', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const sql = readFileSync(join(root, 'drizzle/0009_budget_role.sql'), 'utf8')
  const backfill = sql.slice(sql.indexOf(`UPDATE "transaction" SET "budget_role" = 'INCOME'`))

  expect(backfill).not.toBe('')
  for (const category of INCOME_PLUGGY_CATEGORIES) {
    expect(backfill).toContain(`'${category}'`)
  }
})
