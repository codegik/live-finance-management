/**
 * Brazilian card descriptors are noisy in predictable ways. This function
 * removes the parts that vary between visits to the same merchant, and
 * nothing else.
 *
 * What it deliberately does NOT do is strip city and branch fragments:
 * reducing 'ZAFFARI PORTO ALEG' to 'ZAFFARI' requires knowing that
 * 'PORTO ALEG' is a place, which needs a gazetteer of Brazilian place names
 * and their abbreviations. A heuristic that guessed — dropping trailing
 * tokens, say — would merge genuinely different merchants and silently
 * misfile their spend. An extra inbox group is a visible one-tap cost; a
 * wrongly merged merchant is an invisible, wrong budget. CONTAINS rules are
 * the intended remedy for branch variants.
 *
 * Deterministic and pure. Changing it requires no migration: the nightly
 * reconcile recomputes merchant_normalized household-wide.
 */

const COMBINING_MARKS = /[̀-ͯ]/g
/** '*0421', '*PEDIDO' — an order or terminal id, and everything after it. */
const ASTERISK_TAIL = /\*.*$/
/** 'PARC 03/12', 'PARCELA 3/12', or a bare '03/12'. */
const PARCEL_SUFFIX = /\b(?:PARC(?:ELA)?\.?\s*)?\d{1,2}\s*\/\s*\d{1,2}\b/g
const NON_ALPHANUMERIC = /[^A-Z0-9 ]+/g
/** A store or terminal number left dangling at the end. */
const TRAILING_STORE_NUMBER = /\s+\d{3,}$/
const WHITESPACE = /\s+/g

export function normalizeMerchant(raw: string | null | undefined): string | null {
  if (!raw) return null

  const normalized = raw
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toUpperCase()
    .replace(ASTERISK_TAIL, ' ')
    .replace(PARCEL_SUFFIX, ' ')
    .replace(NON_ALPHANUMERIC, ' ')
    .replace(TRAILING_STORE_NUMBER, ' ')
    .replace(WHITESPACE, ' ')
    .trim()

  return normalized === '' ? null : normalized
}
