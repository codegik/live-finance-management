import { normalizeMerchant } from './categorize'

export type SeedRule = {
  matchType: 'EXACT' | 'CONTAINS'
  /** Written as it appears on the statement; normalized before it is stored. */
  pattern: string
  seedKey: string
}

/**
 * Merchant rules every household starts with.
 *
 * These exist because the household said so, not because Pluggy got them
 * wrong in a way a taxonomy fix could address:
 *
 *   CLUBE LIVELO is a monthly subscription that Pluggy files under
 *   'Mileage programs', which maps to Lazer. It is a standing charge, so it
 *   belongs in Assinaturas. CONTAINS rather than EXACT because the statement
 *   spells it 'CLUBE LIVELO*Clube07/12' -- and deliberately not a bare
 *   'LIVELO', which would also swallow 'LIVELOSANTANA DE P', an unrelated
 *   store.
 *
 *   MECANICA catches the workshops Pluggy does not recognise, alongside the
 *   'Vehicle maintenance' and 'Automotive' categories the map already routes
 *   to the same place.
 *
 * These are defaults in code, not user data: seeding is idempotent against
 * the (household_id, match_type, pattern) unique index, so deleting one in
 * Settings brings it back on the next nightly reconcile. To retire a rule
 * for good, remove it from this list.
 */
export const SEED_MERCHANT_RULES: SeedRule[] = [
  { matchType: 'CONTAINS', pattern: 'CLUBE LIVELO', seedKey: 'subscriptions' },
  { matchType: 'CONTAINS', pattern: 'MECANICA', seedKey: 'car-maintenance' },
]

/** Patterns are stored normalized, so matching is symmetrical with the transaction side. */
export function normalizedSeedRules(): (SeedRule & { pattern: string })[] {
  return SEED_MERCHANT_RULES.map((rule) => {
    const pattern = normalizeMerchant(rule.pattern)
    if (!pattern) throw new Error(`SEED_RULE_EMPTY_PATTERN:${rule.pattern}`)
    return { ...rule, pattern }
  })
}
