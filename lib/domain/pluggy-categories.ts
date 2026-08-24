/**
 * Pluggy's category strings, translated to this household's stable seed keys.
 *
 * Keyed on seed_key rather than on the display name so that renaming a
 * category in Settings does not break auto-categorization.
 *
 * Unmapped is a deliberate answer, not a gap: a string absent here falls
 * through to the inbox, which is visible, rather than to a wrong category,
 * which silently distorts a budget.
 *
 * VERIFIED AGAINST REAL DATA (a live credit-card connection, 1,537
 * transactions, 52 distinct category strings). The first version of this map
 * was written from Pluggy's published taxonomy and the six-row test fixture
 * and covered 36% of it. The near-misses cost the most: the connector emits
 * 'Taxi and ride-hailing', not 'Taxi and ridesharing', and 'Eating out', not
 * 'Restaurants' -- each one silently sent an entire spending category to the
 * inbox. tests/pluggy-category-coverage.test.ts holds the observed strings
 * and their volumes; add a new string there first, and let the failing test
 * prove the map was missing it.
 */
export const PLUGGY_CATEGORY_TO_SEED_KEY: Record<string, string> = {
  // --- Observed on a live connection, ordered by volume ---
  Groceries: 'supermarket',
  'Taxi and ride-hailing': 'transport',
  'Eating out': 'restaurants',
  // Generic retail. 'other' rather than 'clothing': a guess here would put
  // hardware, gifts and electronics into the wardrobe budget.
  Shopping: 'other',
  Clothing: 'clothing',
  'Digital services': 'subscriptions',
  Accomodation: 'leisure',
  Pharmacy: 'pharmacy',
  'Airport and airlines': 'leisure',
  'Gas stations': 'fuel',
  Services: 'home',
  Houseware: 'home',
  Insurance: 'other',
  Bookstore: 'education',
  'Office supplies': 'home',
  School: 'education',
  'Mileage programs': 'leisure',
  Tickets: 'leisure',
  'Wellness and fitness': 'health',
  Gambling: 'leisure',
  Parking: 'transport',
  'Vehicle maintenance': 'car-maintenance',
  Healthcare: 'health',
  Optometry: 'health',
  'Online shopping': 'other',
  Electronics: 'home',
  'Hospital clinics and labs': 'health',
  'Food delivery': 'delivery',
  Rent: 'home',
  'Kids and toys': 'other',
  Gaming: 'leisure',
  Travel: 'leisure',
  'Cinema, theater and concerts': 'leisure',
  Telecommunications: 'home',
  Housing: 'home',
  Leisure: 'leisure',
  'Sports goods': 'leisure',
  Water: 'home',
  'Video streaming': 'subscriptions',
  'Car rental': 'transport',
  Mobile: 'home',
  'Health insurance': 'health',
  'Public transportation': 'transport',
  'Pet supplies and vet': 'pets',
  Automotive: 'car-maintenance',
  Dentist: 'health',
  Lottery: 'leisure',

  // --- From Pluggy's published taxonomy, not seen on this connection ---
  // Kept because a second bank may spell things this way. Unverified: treat
  // a hit here as a hint to move the string up into the block above.
  Supermarkets: 'supermarket',
  Restaurants: 'restaurants',
  Transport: 'transport',
  'Taxi and ridesharing': 'transport',
  Education: 'education',
  Entertainment: 'leisure',
  Subscriptions: 'subscriptions',
  Streaming: 'subscriptions',
  Software: 'subscriptions',
  Utilities: 'home',
  Pets: 'pets',
}

/**
 * Deliberately absent, and they must stay absent:
 *
 *   'Transfers', 'Credit card payment'  -- money moving between the
 *     household's own accounts. The card invoice paid from checking is the
 *     same money as the card transactions it settles; Slice 6 gives these rows
 *     `budget_role = 'TRANSFER'` so they never double-count against a budget.
 *   'Tax on financial operations', 'Credit card fees' -- bank charges, not
 *     a household budget line.
 *
 * Mapping any of these would inflate a category with money that was never
 * spent on that category.
 */

/**
 * The income strings, mapped onto the Receita block.
 *
 * UNVERIFIED, exactly as the lists in lib/domain/budget-role.ts are: no
 * checking account has ever been synced, so these come from Pluggy's
 * published taxonomy rather than from observed rows. They are absent from
 * tests/pluggy-category-coverage.test.ts for that reason -- that table is the
 * record of what a CARD connector emits, and a card emits none of these.
 *
 * Mapping them is safe in the way the transfer strings are not: an income row
 * already carries `budget_role = 'INCOME'`, so it is excluded from every
 * spend query no matter which category it lands on. The worst a wrong mapping
 * here can do is put salary on the wrong Receita line -- it cannot inflate a
 * spending budget.
 */
const PLUGGY_INCOME_TO_SEED_KEY: Record<string, string> = {
  Salary: 'income-salary',
  Retirement: 'income-salary',
  'Interest income': 'income-extra',
  'Investment redemption': 'income-extra',
}

export function seedKeyForPluggyCategory(category: string | null | undefined): string | null {
  if (!category) return null
  return PLUGGY_CATEGORY_TO_SEED_KEY[category] ?? PLUGGY_INCOME_TO_SEED_KEY[category] ?? null
}
