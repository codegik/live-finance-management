import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { isTransfer, TRANSFER_PLUGGY_CATEGORIES } from '@/lib/domain/transfers'

it('recognises the four categories that are not spending', () => {
  expect(isTransfer('Credit card payment')).toBe(true)
  expect(isTransfer('Transfers')).toBe(true)
  expect(isTransfer('Tax on financial operations')).toBe(true)
  expect(isTransfer('Credit card fees')).toBe(true)
})

it('treats ordinary spending categories as spending', () => {
  expect(isTransfer('Groceries')).toBe(false)
  expect(isTransfer('Eating out')).toBe(false)
  expect(isTransfer('Vehicle maintenance')).toBe(false)
})

it('treats an absent category as spending rather than guessing', () => {
  // A transaction Pluggy could not categorize belongs in the inbox, where it
  // is visible -- not silently excluded from every total.
  expect(isTransfer(null)).toBe(false)
  expect(isTransfer(undefined)).toBe(false)
  expect(isTransfer('')).toBe(false)
})

it('keeps the migration backfill in step with the set it copies', () => {
  // 0006 sets is_transfer = false on every pre-existing row and then
  // backfills these four strings in SQL, because refreshTransferFlags is up
  // to a nightly run away. If someone adds a category to the set above and
  // no migration follows, the rows already in the database keep counting as
  // spending -- silently. This is the check that stops that being silent.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const sql = readFileSync(join(root, 'drizzle/0006_budgets.sql'), 'utf8')
  const backfill = sql.slice(sql.indexOf('UPDATE "transaction" SET "is_transfer" = true'))

  expect(backfill).not.toBe('')
  for (const category of TRANSFER_PLUGGY_CATEGORIES) {
    expect(backfill).toContain(`'${category}'`)
  }
})
