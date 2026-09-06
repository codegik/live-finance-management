import { and, eq } from 'drizzle-orm'
import { normalizeMerchant } from '@/lib/domain/categorize'
import type { Db } from './client'
import { recurringExpenses } from './schema'
import type { MatchType } from './merchant-labels'

export type Cadence = 'MONTHLY' | 'ANNUAL'

/**
 * One recurring definition in the shape resolveRecurring matches a row against
 * and the month view projects from. Everything a caller needs to decide, per
 * month, whether the item is fulfilled by a real charge or must be drawn as a
 * `previsto` line.
 */
export type RecurringMatcher = {
  id: string
  matchType: MatchType
  /** Already normalized, so it compares directly to merchant_normalized. */
  pattern: string
  title: string
  categoryId: string
  /** Null = variable: project the rolling average of matched charges. */
  amountCents: number | null
  dayOfMonth: number
  cadence: Cadence
  /** 'YYYY-MM-DD', first of the month. */
  anchorMonth: string
  /** 'YYYY-MM-DD' first of the month, or null to project indefinitely. */
  endMonth: string | null
}

/** Fields a caller supplies to define or redefine a recurring expense. The
 *  pattern is normalized here, exactly as setMerchantLabel does it, so what the
 *  household typed matches what the bank sent. */
export type RecurringInput = {
  matchType: MatchType
  pattern: string
  title: string
  categoryId: string
  amountCents: number | null
  dayOfMonth: number
  cadence: Cadence
  anchorMonth: string
  endMonth?: string | null
}

/**
 * Sets (or replaces) a recurring expense, keyed on (match type, pattern) per
 * household exactly like a merchant label. The pattern is normalized with the
 * same normalizeMerchant the transactions were stored through, so the match is
 * symmetrical with merchant_normalized regardless of case, accents or the
 * instalment suffix.
 *
 * Returns false when the pattern or title is empty, or the pattern normalizes
 * away to nothing (a pure terminal id): there is then no stable text to match
 * on, which the caller reports as such.
 */
export async function setRecurringExpense(
  db: Db,
  householdId: string,
  input: RecurringInput,
): Promise<{ ok: boolean }> {
  const pattern = normalizeMerchant(input.pattern)
  const title = input.title.trim()
  if (!pattern || !title) return { ok: false }

  await db
    .insert(recurringExpenses)
    .values({
      householdId,
      matchType: input.matchType,
      pattern,
      title,
      categoryId: input.categoryId,
      amountCents: input.amountCents,
      dayOfMonth: input.dayOfMonth,
      cadence: input.cadence,
      anchorMonth: input.anchorMonth,
      endMonth: input.endMonth ?? null,
    })
    .onConflictDoUpdate({
      target: [
        recurringExpenses.householdId,
        recurringExpenses.matchType,
        recurringExpenses.pattern,
      ],
      set: {
        title,
        categoryId: input.categoryId,
        amountCents: input.amountCents,
        dayOfMonth: input.dayOfMonth,
        cadence: input.cadence,
        anchorMonth: input.anchorMonth,
        endMonth: input.endMonth ?? null,
        active: true,
        updatedAt: new Date(),
      },
    })
  return { ok: true }
}

/** Removes a recurring expense by its match type and pattern. The pattern is
 *  normalized the same way the set did, so the caller can pass the raw merchant
 *  it was created from. */
export async function clearRecurringExpense(
  db: Db,
  householdId: string,
  input: { matchType: MatchType; pattern: string },
): Promise<{ ok: boolean }> {
  const pattern = normalizeMerchant(input.pattern)
  if (!pattern) return { ok: false }

  await db
    .delete(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.householdId, householdId),
        eq(recurringExpenses.matchType, input.matchType),
        eq(recurringExpenses.pattern, pattern),
      ),
    )
  return { ok: true }
}

/**
 * Every active recurring expense the household has set, ordered
 * most-specific-first so resolveRecurring can take the first match. Same
 * precedence merchant labels and rules use: EXACT before CONTAINS, then the
 * longer pattern, then the pattern text so the outcome never depends on row
 * order. The month view loads this once and resolves each row in memory.
 */
export async function listRecurringExpenses(
  db: Db,
  householdId: string,
): Promise<RecurringMatcher[]> {
  const rows = await db
    .select({
      id: recurringExpenses.id,
      matchType: recurringExpenses.matchType,
      pattern: recurringExpenses.pattern,
      title: recurringExpenses.title,
      categoryId: recurringExpenses.categoryId,
      amountCents: recurringExpenses.amountCents,
      dayOfMonth: recurringExpenses.dayOfMonth,
      cadence: recurringExpenses.cadence,
      anchorMonth: recurringExpenses.anchorMonth,
      endMonth: recurringExpenses.endMonth,
    })
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.householdId, householdId),
        eq(recurringExpenses.active, true),
      ),
    )

  return rows.sort(recurringPrecedence)
}

/** EXACT before CONTAINS, then longer pattern, then text. Exported so the
 *  ordering the resolver depends on can be tested without a database. */
export function recurringPrecedence(a: RecurringMatcher, b: RecurringMatcher): number {
  if (a.matchType !== b.matchType) return a.matchType === 'EXACT' ? -1 : 1
  if (a.pattern.length !== b.pattern.length) return b.pattern.length - a.pattern.length
  return a.pattern.localeCompare(b.pattern)
}

/**
 * Whether one recurring definition's pattern matches a normalized merchant --
 * the same EXACT/CONTAINS test resolveLabel and resolveCategory use, factored
 * out so both the resolver and the month view's fulfilment check apply it
 * identically. A charge fulfils a recurrence iff this is true for it.
 */
export function matchesRecurring(
  item: Pick<RecurringMatcher, 'matchType' | 'pattern'>,
  merchantNormalized: string | null,
): boolean {
  if (!merchantNormalized) return false
  return item.matchType === 'EXACT'
    ? merchantNormalized === item.pattern
    : merchantNormalized.includes(item.pattern)
}

/**
 * The recurring definition a row's merchant fulfils, or null. `recurring` must
 * already be ordered by listRecurringExpenses; the first match wins.
 *
 * A definition only matches within its own category: two recurring items can
 * share a merchant across categories (a shop billed to both Saúde and Lazer),
 * and a charge fulfils the one filed where it sits. Pass the row's categoryId
 * to honour that; pass undefined to match on merchant alone.
 */
export function resolveRecurring(
  recurring: RecurringMatcher[],
  merchantNormalized: string | null,
  categoryId?: string | null,
): RecurringMatcher | null {
  if (!merchantNormalized) return null
  const hit = recurring.find((r) => {
    if (categoryId !== undefined && r.categoryId !== categoryId) return false
    return matchesRecurring(r, merchantNormalized)
  })
  return hit ?? null
}

/**
 * Whether a recurring item should draw a projected line in a given month.
 * Bounded by its window -- never before it started, never after it ended -- and
 * gated by cadence: MONTHLY lands every month in the window, ANNUAL only in the
 * month of the year its anchor names. `period` is 'YYYY-MM'.
 *
 * Pure and total so the cadence rule can be tested without a month view: the
 * view asks this before it considers whether a real charge fulfilled the item.
 */
export function projectsInPeriod(
  item: Pick<RecurringMatcher, 'cadence' | 'anchorMonth' | 'endMonth'>,
  period: string,
): boolean {
  const anchor = item.anchorMonth.slice(0, 7)
  if (period < anchor) return false
  if (item.endMonth && period > item.endMonth.slice(0, 7)) return false
  if (item.cadence === 'ANNUAL') return period.slice(5, 7) === anchor.slice(5, 7)
  return true
}

/**
 * The amount to project for a recurring item in a month it is NOT fulfilled by
 * a real charge. A fixed item projects its stored amount; a variable one (null
 * amount) projects the rolling average of the charges its pattern has already
 * matched. Returns 0 when a variable item has no history yet -- an honest "we
 * don't know what to expect" that shows a named line at R$ 0,00 rather than
 * inventing a number.
 *
 * `pastMatchedAmounts` is the amount_cents of prior charges the item's pattern
 * matched, newest first; the caller (the month view) already resolves those
 * when it de-dups, so this stays a pure function over numbers.
 */
export function projectedAmountCents(
  item: Pick<RecurringMatcher, 'amountCents'>,
  pastMatchedAmounts: number[],
  window = 3,
): number {
  if (item.amountCents !== null) return item.amountCents
  const sample = pastMatchedAmounts.slice(0, window)
  if (sample.length === 0) return 0
  const sum = sample.reduce((acc, cents) => acc + cents, 0)
  return Math.round(sum / sample.length)
}

export { normalizeMerchant }
