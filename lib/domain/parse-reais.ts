/**
 * A Brazilian household writes '1.200,50'; a keyboard often produces
 * '1200.50'. Both must mean the same amount.
 *
 * When a comma is present it is the decimal separator and every dot is a
 * thousands separator. With no comma, a lone dot is ambiguous -- '1.200' is
 * one thousand two hundred, '1200.50' is twelve hundred and fifty centavos.
 * A dot followed by exactly three digits is a thousands separator; anything
 * else is a decimal point. That is the rule Brazilian formatting actually
 * follows, and getting it wrong overstates a budget by 100x.
 *
 * Returns null for an empty field -- the caller reads that as "clear the
 * budget" -- and throws INVALID_AMOUNT for anything that is not a
 * non-negative number.
 */
export function parseReais(raw: string): number | null {
  const trimmed = raw.trim().replace(/^R\$\s*/i, '')
  if (trimmed === '') return null

  let normalized: string
  if (trimmed.includes(',')) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.')
  } else if (/\.\d{3}$/.test(trimmed) || /\.\d{3}\./.test(trimmed)) {
    normalized = trimmed.replace(/\./g, '')
  } else {
    normalized = trimmed
  }

  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) throw new Error('INVALID_AMOUNT')

  return Math.round(value * 100)
}
