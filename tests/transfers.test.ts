import { expect, it } from 'vitest'
import { isTransfer } from '@/lib/domain/transfers'

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
