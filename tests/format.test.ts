import { expect, it } from 'vitest'
import { accountLabel, brl, brlCompact, brlSigned, monthLabel, monthShort } from '@/lib/format'

it('never prints minus zero', () => {
  // Intl.NumberFormat renders -0 as "-R$ 0,00", and a subtraction landing on
  // zero produces -0 more often than it looks like it should.
  expect(brl(-0)).toBe(brl(0))
  expect(brl(-0)).not.toContain('-')
})

it('formats a month label in the household language without shifting the month', () => {
  // The period is a calendar month already bucketed to America/Sao_Paulo at
  // ingest. Re-applying a zone here is how '2026-01' renders as December.
  expect(monthLabel('2026-01')).toBe('Janeiro de 2026')
  expect(monthLabel('2026-12')).toBe('Dezembro de 2026')
  expect(monthShort('2026-08')).toBe('Ago')
})

it('shows an empty grid cell as empty rather than as a zero', () => {
  expect(brlCompact(0)).toBe('—')
  expect(brlCompact(1_234_56)).toBe('1.235')
})

it('always carries the sign on a difference against a plan', () => {
  expect(brlSigned(10_000).startsWith('+')).toBe(true)
  expect(brlSigned(-10_000).startsWith('−')).toBe(true)
})

it('names a card by its digits and never by its marketing name', () => {
  // "LATAM PASS ITAU MASTERCARD BLACK" is the account name, but on a phone row
  // the four digits are what tell one card from another.
  expect(accountLabel({ type: 'CREDIT', institution: 'Itaú', last4: '1885' })).toBe(
    'Cartão ···· 1885',
  )
  expect(accountLabel({ type: 'CREDIT', institution: 'Itaú', last4: null })).toBe('Cartão')
})

it('names a bank by its first word only, so a long name still fits', () => {
  expect(accountLabel({ type: 'BANK', institution: 'Banco do Brasil', last4: '0001' })).toBe(
    'Banco ···· 0001',
  )
  expect(accountLabel({ type: 'BANK', institution: 'Sicredi', last4: null })).toBe('Sicredi')
})
