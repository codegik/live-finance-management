import { expect, it } from 'vitest'
import { brl, brlCompact, brlSigned, monthLabel, monthShort } from '@/lib/format'

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
