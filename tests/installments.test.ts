import { expect, it } from 'vitest'
import { parseInstallment } from '@/lib/domain/installments'

it('reads a bare parcel suffix', () => {
  expect(parseInstallment('AUTO MECANICA BOA 01/10')).toEqual({ number: 1, total: 10 })
  expect(parseInstallment('AUTO MECANICA BOA 10/10')).toEqual({ number: 10, total: 10 })
})

it('reads both spellings of an explicit parcel marker', () => {
  expect(parseInstallment('ZAFFARI CENTRO PARC 03/12')).toEqual({ number: 3, total: 12 })
  expect(parseInstallment('ZAFFARI CENTRO PARCELA 3/12')).toEqual({ number: 3, total: 12 })
})

it('reads a parcel suffix glued to asterisk noise', () => {
  // Verbatim from a live statement.
  expect(parseInstallment('CLUBE LIVELO*Clube07/12')).toEqual({ number: 7, total: 12 })
})

it('returns null when there is no parcel suffix', () => {
  expect(parseInstallment('ZAFFARI PORTO ALEG')).toBeNull()
  expect(parseInstallment(null)).toBeNull()
  expect(parseInstallment('')).toBeNull()
})

it('rejects a suffix that cannot be a real instalment', () => {
  // A parcel is 1..total, and a single-part purchase is not an instalment.
  expect(parseInstallment('LOJA 00/12')).toBeNull()
  expect(parseInstallment('LOJA 13/12')).toBeNull()
  expect(parseInstallment('LOJA 01/01')).toBeNull()
})

it('does not read a parcel out of the tail of a longer number', () => {
  // Without a digit guard this yields a phantom 10-part commitment.
  expect(parseInstallment('POSTO 44710/12')).toBeNull()
})
