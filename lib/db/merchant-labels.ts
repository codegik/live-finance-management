import { and, eq } from 'drizzle-orm'
import { normalizeMerchant } from '@/lib/domain/categorize'
import type { Db } from './client'
import { merchantLabels } from './schema'

export type MatchType = 'EXACT' | 'CONTAINS'

/** One household label, in the shape resolveLabel matches a row against. */
export type MerchantLabelMatcher = {
  matchType: MatchType
  /** Already normalized, so it compares directly to merchant_normalized. */
  pattern: string
  label: string
}

/**
 * Sets (or replaces) a household label, matched the way a merchant rule is: an
 * EXACT or CONTAINS pattern. The pattern is normalized here with the very same
 * normalizeMerchant the transactions were stored through, so what the household
 * typed matches what the bank sent regardless of case, accents or the
 * instalment suffix.
 *
 * Returns false when the pattern or label is empty, or when the pattern
 * normalizes away to nothing (a pure terminal id): there is then no stable text
 * to match on, which the caller reports as such.
 */
export async function setMerchantLabel(
  db: Db,
  householdId: string,
  input: { matchType: MatchType; pattern: string; label: string },
): Promise<{ ok: boolean }> {
  const pattern = normalizeMerchant(input.pattern)
  const label = input.label.trim()
  if (!pattern || !label) return { ok: false }

  await db
    .insert(merchantLabels)
    .values({ householdId, matchType: input.matchType, pattern, label })
    .onConflictDoUpdate({
      target: [merchantLabels.householdId, merchantLabels.matchType, merchantLabels.pattern],
      set: { label, updatedAt: new Date() },
    })
  return { ok: true }
}

/** Removes a household label by its match type and pattern, falling every row
 *  it matched back to its bank descriptor. The pattern is normalized the same
 *  way the set did, so the caller can pass the raw merchant it was created from. */
export async function clearMerchantLabel(
  db: Db,
  householdId: string,
  input: { matchType: MatchType; pattern: string },
): Promise<{ ok: boolean }> {
  const pattern = normalizeMerchant(input.pattern)
  if (!pattern) return { ok: false }

  await db
    .delete(merchantLabels)
    .where(
      and(
        eq(merchantLabels.householdId, householdId),
        eq(merchantLabels.matchType, input.matchType),
        eq(merchantLabels.pattern, pattern),
      ),
    )
  return { ok: true }
}

/**
 * Every label the household has set, ordered most-specific-first so resolveLabel
 * can take the first match. The views load this once and resolve each row in
 * memory -- a household has few labels, and iterating a short list per row is
 * cheaper than threading a join through every transaction query.
 *
 * Order: EXACT before CONTAINS (an exact name for one descriptor beats a broad
 * substring), then the longer pattern first (the more specific of two
 * substrings), then the pattern text so the outcome never depends on row order.
 * This mirrors the specific-beats-broad precedence resolveCategory gives rules.
 */
export async function listMerchantLabels(
  db: Db,
  householdId: string,
): Promise<MerchantLabelMatcher[]> {
  const rows = await db
    .select({
      matchType: merchantLabels.matchType,
      pattern: merchantLabels.pattern,
      label: merchantLabels.label,
    })
    .from(merchantLabels)
    .where(eq(merchantLabels.householdId, householdId))

  return rows.sort((a, b) => {
    if (a.matchType !== b.matchType) return a.matchType === 'EXACT' ? -1 : 1
    if (a.pattern.length !== b.pattern.length) return b.pattern.length - a.pattern.length
    return a.pattern.localeCompare(b.pattern)
  })
}

/**
 * The label for one row's merchant, or null. A single matching point so every
 * view resolves a display name identically, using the same EXACT/CONTAINS test
 * the rule engine uses (see resolveCategory). `labels` must already be ordered
 * by listMerchantLabels; the first match wins.
 */
export function resolveLabel(
  labels: MerchantLabelMatcher[],
  merchantNormalized: string | null,
): string | null {
  if (!merchantNormalized) return null
  const hit = labels.find((l) =>
    l.matchType === 'EXACT' ? merchantNormalized === l.pattern : merchantNormalized.includes(l.pattern),
  )
  return hit?.label ?? null
}

export { normalizeMerchant }
