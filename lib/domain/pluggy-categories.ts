/**
 * Pluggy's category strings, translated to this household's stable seed keys.
 *
 * Keyed on seed_key rather than on the display name so that renaming a
 * category in Settings does not break auto-categorization.
 *
 * Unmapped is a deliberate answer, not a gap: a string absent here falls
 * through to the inbox, which is visible, rather than to a wrong category,
 * which silently distorts a budget. 'Fees' is unmapped for exactly that
 * reason — a bank fee is not one of the household's budget lines.
 *
 * VERIFY AGAINST REAL DATA: these strings come from Pluggy's documented
 * taxonomy and the recorded fixtures. Once real cards are connected, check
 * the inbox for high-volume strings that should be mapped here.
 */
export const PLUGGY_CATEGORY_TO_SEED_KEY: Record<string, string> = {
  Supermarkets: 'supermarket',
  Groceries: 'supermarket',
  Restaurants: 'restaurants',
  'Food delivery': 'delivery',
  Transport: 'transport',
  'Taxi and ridesharing': 'transport',
  'Public transportation': 'transport',
  'Gas stations': 'fuel',
  Healthcare: 'health',
  Pharmacy: 'pharmacy',
  Housing: 'home',
  Utilities: 'home',
  Education: 'education',
  Entertainment: 'leisure',
  Travel: 'leisure',
  Clothing: 'clothing',
  Shopping: 'clothing',
  Subscriptions: 'subscriptions',
  Streaming: 'subscriptions',
  Software: 'subscriptions',
  Pets: 'pets',
}

export function seedKeyForPluggyCategory(category: string | null | undefined): string | null {
  if (!category) return null
  return PLUGGY_CATEGORY_TO_SEED_KEY[category] ?? null
}
