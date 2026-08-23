import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  classifyRole,
  INCOME_PLUGGY_CATEGORIES,
  TRANSFER_PLUGGY_CATEGORIES,
} from '@/lib/domain/budget-role'

it('classifies the four categories that are money moving, not spending', () => {
  expect(classifyRole('Credit card payment')).toBe('TRANSFER')
  expect(classifyRole('Transfers')).toBe('TRANSFER')
  expect(classifyRole('Tax on financial operations')).toBe('TRANSFER')
  expect(classifyRole('Credit card fees')).toBe('TRANSFER')
})

it('classifies money arriving as income', () => {
  for (const category of INCOME_PLUGGY_CATEGORIES) {
    expect(classifyRole(category)).toBe('INCOME')
  }
  expect(INCOME_PLUGGY_CATEGORIES.size).toBeGreaterThan(0)
})

it('classifies ordinary spending as spending', () => {
  expect(classifyRole('Groceries')).toBe('SPEND')
  expect(classifyRole('Eating out')).toBe('SPEND')
  expect(classifyRole('Vehicle maintenance')).toBe('SPEND')
})

it('treats an absent category as spending rather than guessing', () => {
  // A transaction Pluggy could not categorize belongs in the inbox, where it
  // is visible -- not silently excluded from every total.
  expect(classifyRole(null)).toBe('SPEND')
  expect(classifyRole(undefined)).toBe('SPEND')
  expect(classifyRole('')).toBe('SPEND')
})

it('keeps income and transfer disjoint', () => {
  // Both exclude a row from the budget, but they are not interchangeable:
  // a string in both sets means classifyRole's precedence decides silently.
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
