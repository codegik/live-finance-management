import { expect, it } from 'vitest'
import {
  resolveCategory,
  type RuleForResolution,
  type TransactionForResolution,
} from '@/lib/domain/categorize'
import { seedKeyForPluggyCategory } from '@/lib/domain/pluggy-categories'

const SUPERMARKET = '11111111-1111-1111-1111-111111111111'
const LEISURE = '22222222-2222-2222-2222-222222222222'
const DELIVERY = '33333333-3333-3333-3333-333333333333'

const seedMap = new Map([
  ['supermarket', SUPERMARKET],
  ['leisure', LEISURE],
  ['delivery', DELIVERY],
])

function tx(over: Partial<TransactionForResolution> = {}): TransactionForResolution {
  return {
    merchantNormalized: 'ZAFFARI',
    pluggyCategory: 'Supermarkets',
    categoryId: null,
    categorySource: null,
    ...over,
  }
}

function rule(over: Partial<RuleForResolution> = {}): RuleForResolution {
  return {
    id: 'aaaa',
    matchType: 'EXACT',
    pattern: 'ZAFFARI',
    categoryId: LEISURE,
    priority: 100,
    ...over,
  }
}

it('returns a manual category untouched, whatever the rules and Pluggy say', () => {
  const result = resolveCategory(
    tx({ categoryId: DELIVERY, categorySource: 'MANUAL' }),
    [rule()],
    seedMap,
  )

  expect(result).toEqual({ categoryId: DELIVERY, source: 'MANUAL' })
})

it('prefers a merchant rule over Pluggy', () => {
  expect(resolveCategory(tx(), [rule()], seedMap)).toEqual({
    categoryId: LEISURE,
    source: 'RULE',
  })
})

it('falls back to Pluggy when no rule matches', () => {
  expect(resolveCategory(tx(), [rule({ pattern: 'CARREFOUR' })], seedMap)).toEqual({
    categoryId: SUPERMARKET,
    source: 'PLUGGY',
  })
})

it('sends an unmapped Pluggy category to the inbox rather than guessing', () => {
  // 'Fees' is deliberately unmapped: a bank fee is not a household budget line.
  expect(resolveCategory(tx({ pluggyCategory: 'Fees' }), [], seedMap)).toEqual({
    categoryId: null,
    source: null,
  })
})

it('sends a mapping that points at an archived category to the inbox', () => {
  // Callers pass only non-archived categories, so the seed key simply misses.
  expect(resolveCategory(tx(), [], new Map())).toEqual({ categoryId: null, source: null })
})

it('matches a CONTAINS rule against a branch variant', () => {
  const result = resolveCategory(
    tx({ merchantNormalized: 'ZAFFARI PORTO ALEG', pluggyCategory: null }),
    [rule({ matchType: 'CONTAINS', pattern: 'ZAFFARI' })],
    seedMap,
  )

  expect(result).toEqual({ categoryId: LEISURE, source: 'RULE' })
})

it('lets a lower priority number win, and breaks ties on id so the answer is stable', () => {
  const broad = rule({ id: 'bbbb', matchType: 'CONTAINS', pattern: 'ZAF', categoryId: DELIVERY, priority: 200 })
  const specific = rule({ id: 'aaaa', categoryId: LEISURE, priority: 100 })

  expect(resolveCategory(tx(), [broad, specific], seedMap).categoryId).toBe(LEISURE)
  expect(resolveCategory(tx(), [specific, broad], seedMap).categoryId).toBe(LEISURE)

  const tied = [
    rule({ id: 'bbbb', categoryId: DELIVERY, priority: 100 }),
    rule({ id: 'aaaa', categoryId: LEISURE, priority: 100 }),
  ]
  expect(resolveCategory(tx(), tied, seedMap).categoryId).toBe(LEISURE)
})

it('skips rule matching entirely when there is no merchant to match on', () => {
  const result = resolveCategory(
    tx({ merchantNormalized: null, pluggyCategory: 'Supermarkets' }),
    [rule({ matchType: 'CONTAINS', pattern: 'ZAFFARI' })],
    seedMap,
  )

  expect(result).toEqual({ categoryId: SUPERMARKET, source: 'PLUGGY' })
})

it('maps the Pluggy strings the fixtures actually use', () => {
  expect(seedKeyForPluggyCategory('Supermarkets')).toBe('supermarket')
  expect(seedKeyForPluggyCategory('Food delivery')).toBe('delivery')
  expect(seedKeyForPluggyCategory('Subscriptions')).toBe('subscriptions')
  expect(seedKeyForPluggyCategory('Fees')).toBeNull()
  expect(seedKeyForPluggyCategory(null)).toBeNull()
})
