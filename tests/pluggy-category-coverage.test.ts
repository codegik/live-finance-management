import { expect, it } from 'vitest'
import { seedKeyForPluggyCategory } from '@/lib/domain/pluggy-categories'
import { SEED_CATEGORIES } from '@/lib/domain/seed-categories'

/**
 * The category strings a real Brazilian credit-card connector actually
 * returns, with the volumes observed across 1,537 live transactions.
 *
 * The original map was written from Pluggy's published taxonomy and the
 * six-row test fixture, and covered only 36% of this. The near-misses were
 * the expensive part: the connector says 'Taxi and ride-hailing', not
 * 'Taxi and ridesharing'; 'Eating out', not 'Restaurants'. Every one of
 * those silently sent a whole spending category to the inbox.
 *
 * This table is the record of what the connector really emits. When a new
 * string shows up in the inbox in volume, add it here first — the failing
 * test is what proves the map was missing it.
 */
const OBSERVED: [category: string, volume: number][] = [
  ['Groceries', 291], ['Taxi and ride-hailing', 181], ['Eating out', 161],
  ['Shopping', 83], ['Clothing', 72], ['Tax on financial operations', 60],
  ['Digital services', 54], ['Accomodation', 50], ['Pharmacy', 48],
  ['Airport and airlines', 41], ['Gas stations', 39], ['Transfers', 38],
  ['Services', 33], ['Houseware', 28], ['Insurance', 27], ['Bookstore', 25],
  ['Office supplies', 25], ['School', 24], ['Mileage programs', 21],
  ['Tickets', 19], ['Wellness and fitness', 19], ['Gambling', 18],
  ['Parking', 14], ['Vehicle maintenance', 13], ['Healthcare', 13],
  ['Optometry', 12], ['Online shopping', 10], ['Credit card payment', 10],
  ['Electronics', 8], ['Hospital clinics and labs', 6], ['Food delivery', 6],
  ['Credit card fees', 5], ['Rent', 4], ['Kids and toys', 4], ['Gaming', 3],
  ['Travel', 3], ['Cinema, theater and concerts', 3], ['Telecommunications', 3],
  ['Housing', 3], ['Leisure', 2], ['Sports goods', 2], ['Water', 2],
  ['Video streaming', 2], ['Car rental', 1], ['Mobile', 1],
  ['Health insurance', 1], ['Public transportation', 1],
  ['Pet supplies and vet', 1], ['Automotive', 1], ['Dentist', 1], ['Lottery', 1],
]

/**
 * Deliberately unmapped: an invoice payment, a transfer between own accounts
 * and a bank fee are not household budget lines. Slice 6 gives them
 * `budget_role = 'TRANSFER'` so they do not double-count; until then they
 * stay uncategorized rather than inflating a category.
 */
const INTENTIONALLY_UNMAPPED = new Set([
  'Tax on financial operations',
  'Transfers',
  'Credit card payment',
  'Credit card fees',
])

const SEED_KEYS = new Set(SEED_CATEGORIES.map((c) => c.seedKey))

it('maps every observed connector category that is a real budget line', () => {
  const missing = OBSERVED.filter(
    ([category]) => !INTENTIONALLY_UNMAPPED.has(category) && !seedKeyForPluggyCategory(category),
  )

  expect(missing).toEqual([])
})

it('sends invoice payments, transfers and fees to the inbox rather than a budget', () => {
  for (const category of INTENTIONALLY_UNMAPPED) {
    expect(seedKeyForPluggyCategory(category)).toBeNull()
  }
})

it('only ever maps onto seed keys the taxonomy actually defines', () => {
  const orphans = OBSERVED.flatMap(([category]) => {
    const key = seedKeyForPluggyCategory(category)
    return key && !SEED_KEYS.has(key) ? [[category, key]] : []
  })

  expect(orphans).toEqual([])
})

it('covers at least 85% of observed transaction volume', () => {
  const total = OBSERVED.reduce((sum, [, n]) => sum + n, 0)
  const mapped = OBSERVED.reduce(
    (sum, [category, n]) => (seedKeyForPluggyCategory(category) ? sum + n : sum),
    0,
  )

  // 36% before this fix. The remainder is the intentionally-unmapped 113.
  expect(mapped / total).toBeGreaterThan(0.85)
})
