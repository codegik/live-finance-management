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

it('does not read a Brazilian date as an instalment', () => {
  // A date is spelled exactly like a parcel suffix. Every one of these
  // parsed as a commitment before the trailing guard rejected a following
  // slash as well as a following digit; only DD > MM was ever caught, and
  // then only by the 1..total sanity check.
  expect(parseInstallment('PAGTO 01/12/2024')).toBeNull()
  expect(parseInstallment('VENC 02/10/2026')).toBeNull()
  expect(parseInstallment('PIX 05/09/2026')).toBeNull()
})

it('does not read a two-digit-year date as an instalment', () => {
  // The trailing guard alone only stops the match STARTING at '01/12'; the
  // engine then slides one field along and reads '12/24' -- a valid-looking
  // parcel 12 of 24, a phantom commitment two years wide. Only the symmetric
  // LEADING slash guard rejects a candidate that follows a slash.
  expect(parseInstallment('PAGTO 01/12/24')).toBeNull()
  expect(parseInstallment('BOLETO 03/06/28')).toBeNull()
})

it('still reads a suffix glued to a trailing letter', () => {
  // Deliberate looseness: real descriptors truncate mid-word, and the
  // digit/slash guards are about neighbouring NUMBERS, not letters.
  expect(parseInstallment('07/12X')).toEqual({ number: 7, total: 12 })
})
