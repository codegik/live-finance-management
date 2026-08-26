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

import { seedKeyForPluggyCategory } from './pluggy-categories'

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

export type CategorySource = 'PLUGGY' | 'RULE' | 'MANUAL'

export type RuleForResolution = {
  id: string
  matchType: 'EXACT' | 'CONTAINS'
  pattern: string
  categoryId: string
  priority: number
  // Optional bank scope. Null/undefined applies to every bank; set, the rule
  // only matches a transaction whose connection is the same.
  connectionId?: string | null
}

export type TransactionForResolution = {
  merchantNormalized: string | null
  pluggyCategory: string | null
  categoryId: string | null
  categorySource: CategorySource | null
  // The connection (bank) the transaction's account belongs to, used to
  // honour a rule's optional bank scope. Undefined where a caller matches
  // merchant-only and has no bank to check against.
  connectionId?: string | null
}

export type Resolution = { categoryId: string | null; source: CategorySource | null }

/**
 * The single decision in this slice, in strict precedence order.
 *
 * `categoryIdBySeedKey` must contain only non-archived categories: an
 * archived category is then simply absent, and its Pluggy hits fall through
 * to the inbox without a special case here.
 *
 * Rules are sorted per call. At household scale (tens of rules) that cost is
 * irrelevant, and it makes the function safe to hand an unsorted array —
 * a footgun worth more than the microseconds.
 */
export function resolveCategory(
  tx: TransactionForResolution,
  rules: RuleForResolution[],
  categoryIdBySeedKey: Map<string, string>,
): Resolution {
  // 1. A hand-set category is never reconsidered.
  if (tx.categorySource === 'MANUAL') {
    return { categoryId: tx.categoryId, source: 'MANUAL' }
  }

  // 2. Merchant rules, lowest priority number first, ties broken on id so
  //    the outcome never depends on row order.
  const merchant = tx.merchantNormalized
  if (merchant) {
    const ordered = [...rules].sort(
      (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
    )
    const hit = ordered.find((rule) => {
      // A bank-scoped rule only applies to its own bank; an unscoped rule
      // (null connectionId) applies to every bank as before.
      if (rule.connectionId && rule.connectionId !== tx.connectionId) return false
      return rule.matchType === 'EXACT'
        ? merchant === rule.pattern
        : merchant.includes(rule.pattern)
    })
    if (hit) return { categoryId: hit.categoryId, source: 'RULE' }
  }

  // 3. Pluggy's own category, through the seed-key map.
  const seedKey = seedKeyForPluggyCategory(tx.pluggyCategory)
  const mapped = seedKey ? categoryIdBySeedKey.get(seedKey) : undefined
  if (mapped) return { categoryId: mapped, source: 'PLUGGY' }

  // 4. The inbox.
  return { categoryId: null, source: null }
}
