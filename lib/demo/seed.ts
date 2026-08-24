import { and, eq, inArray, sql } from 'drizzle-orm'
import { setBudget } from '@/lib/db/budgets'
import type { Db } from '@/lib/db/client'
import {
  accounts,
  budgets,
  categories,
  connections,
  transactions,
  users,
} from '@/lib/db/schema'
import { addMonths, monthBounds } from '@/lib/domain/budget'
import { saoPauloPeriod } from '@/lib/domain/dates'
import { normalizeMerchant } from '@/lib/domain/categorize'
import { seedKeyForPluggyCategory } from '@/lib/domain/pluggy-categories'
import {
  DEMO_EXTRA_INCOME,
  DEMO_FIXED,
  DEMO_INCOME,
  DEMO_INSTALMENTS,
  DEMO_INVESTMENTS,
  DEMO_LUMP_INVESTMENTS,
  DEMO_UNCATEGORIZED,
  DEMO_VARIABLE,
  type DemoLine,
} from './data'

/**
 * Everything the demo writes is hung off this one connection, so removing it
 * removes the lot. A fixed id rather than a random one: re-running must
 * update the same rows instead of growing a second demo bank every time.
 */
export const DEMO_ITEM_ID = 'demo-local-fixture'
export const DEMO_INSTITUTION = 'Demo (dados gerados)'

/** How much history to write. Two years, so the year grid has a previous year. */
const MONTHS_OF_HISTORY = 24

/**
 * A demo that generates different figures on every run is a demo you cannot
 * talk about: "the July number is wrong" stops meaning anything. mulberry32
 * is seeded from a constant, so the same command always produces the same
 * household -- which is also what lets `clear` recognise a plan the demo
 * wrote and left untouched, and keep one the household has since edited.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Refuses to touch anything that is not obviously a local database.
 *
 * This writes invented salaries and invented spending. On a real household's
 * database that is not test data, it is corruption of the only record they
 * have -- and it would be indistinguishable from their own figures within a
 * day. Hence a check that fails closed: an unparseable URL is rejected too.
 */
export function assertLocalDatabase(url: string, nodeEnv = process.env.NODE_ENV): void {
  if (nodeEnv === 'production') {
    throw new Error('DEMO_REFUSED: NODE_ENV is production.')
  }

  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error('DEMO_REFUSED: DATABASE_URL could not be parsed, so it cannot be checked.')
  }

  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  if (!local) {
    throw new Error(
      `DEMO_REFUSED: DATABASE_URL points at "${host}", not localhost. Demo data is local-only.`,
    )
  }
}

type Ctx = {
  db: Db
  householdId: string
  cardAccountId: string
  bankAccountId: string
  categoryBySeedKey: Map<string, string>
  periods: string[]
  today: string
  rng: () => number
  rows: (typeof transactions.$inferInsert)[]
}

/** A day in the month, biased away from the 1st so a month is not front-loaded. */
function dayIn(period: string, rng: () => number): string {
  const { end } = monthBounds(period)
  const last = Number(end.slice(8, 10))
  const day = 1 + Math.floor(rng() * last)
  return `${period}-${String(day).padStart(2, '0')}`
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]
}

/**
 * Splits a month's total for one line into individual purchases.
 *
 * Round numbers are the tell that data is fake, so each purchase gets its own
 * jitter and the remainder lands on the last one -- the parts always add back
 * up to the month's total.
 */
function split(totalCents: number, parts: number, rng: () => number): number[] {
  if (parts <= 1) return [totalCents]
  const weights = Array.from({ length: parts }, () => 0.5 + rng())
  const sum = weights.reduce((a, b) => a + b, 0)
  const out = weights.map((w) => Math.round((totalCents * w) / sum))
  out[parts - 1] += totalCents - out.reduce((a, b) => a + b, 0)
  return out
}

function push(ctx: Ctx, row: Omit<typeof transactions.$inferInsert, 'pluggyTransactionId'>): void {
  const merchant = row.merchantRaw ?? row.description
  ctx.rows.push({
    ...row,
    // Positional and stable: re-running writes the same ids, so the upsert
    // updates rather than duplicating.
    pluggyTransactionId: `demo-${ctx.rows.length}`,
    merchantNormalized: normalizeMerchant(merchant),
  })
}

/**
 * Resolves a line to a category the way the sync would: through the Pluggy
 * map where there is a string for it, and directly where there is not.
 *
 * A row assigned directly is marked MANUAL, which is true -- it is not the
 * connector's opinion -- and has the useful side effect that `recategorize`
 * leaves it alone, so an investment stays an investment.
 */
function categorize(
  ctx: Ctx,
  line: { seedKey: string; pluggyCategory: string | null },
): Pick<typeof transactions.$inferInsert, 'categoryId' | 'categorySource' | 'pluggyCategory'> {
  const mapped = line.pluggyCategory ? seedKeyForPluggyCategory(line.pluggyCategory) : null

  if (mapped && ctx.categoryBySeedKey.has(mapped)) {
    return {
      pluggyCategory: line.pluggyCategory,
      categoryId: ctx.categoryBySeedKey.get(mapped)!,
      categorySource: 'PLUGGY',
    }
  }

  return {
    pluggyCategory: line.pluggyCategory,
    categoryId: ctx.categoryBySeedKey.get(line.seedKey) ?? null,
    categorySource: ctx.categoryBySeedKey.has(line.seedKey) ? 'MANUAL' : null,
  }
}

function writeLine(ctx: Ctx, line: DemoLine, period: string, isIncome: boolean): void {
  if (line.medianCents === 0 || line.perMonth === 0) return

  const swing = 1 + (ctx.rng() * 2 - 1) * line.spread
  const monthTotal = Math.round(line.medianCents * swing)
  const accountId = line.account === 'CARD' ? ctx.cardAccountId : ctx.bankAccountId

  for (const amount of split(monthTotal, line.perMonth, ctx.rng)) {
    if (amount <= 0) continue
    const merchant = pick(line.merchants, ctx.rng)
    push(ctx, {
      accountId,
      date: dayIn(period, ctx.rng),
      // Money out is positive centavos, money in negative. See
      // lib/domain/money.ts -- the whole app depends on this sign.
      amountCents: isIncome ? -amount : amount,
      description: merchant,
      merchantRaw: merchant,
      budgetRole: isIncome ? 'INCOME' : 'SPEND',
      ...categorize(ctx, line),
    })
  }
}

function writeInstalments(ctx: Ctx): void {
  const current = ctx.periods[ctx.periods.length - 1]

  for (const plan of DEMO_INSTALMENTS) {
    const each = Math.round(plan.totalCents / plan.count)
    for (let n = 1; n <= plan.count; n += 1) {
      const period = addMonths(current, n - 1 - plan.startedMonthsAgo)
      const label = `${plan.merchant} ${String(n).padStart(2, '0')}/${plan.count}`
      push(ctx, {
        accountId: ctx.cardAccountId,
        date: dayIn(period, ctx.rng),
        amountCents: each,
        description: label,
        merchantRaw: plan.merchant,
        budgetRole: 'SPEND',
        installmentNumber: n,
        installmentTotal: plan.count,
        ...categorize(ctx, plan),
      })
    }
  }
}

/**
 * The plan the demo writes, as category id to centavos.
 *
 * Exported and shared with `clearDemoData`, which has to recognise a plan it
 * wrote in order to leave an edited one alone. Computing it twice is how the
 * two would drift until clear silently stopped removing anything.
 *
 * Occasional money is amortised rather than ignored. The lump investments and
 * the extra income do not recur monthly, but a plan that omits them reads as
 * "1767% of plan" against a month that happened to hold one -- which makes the
 * comparison look broken rather than making the month look unusual.
 */
export function demoPlanCents(categoryBySeedKey: Map<string, string>): Map<string, number> {
  const perSeedKey = new Map<string, number>()
  const add = (seedKey: string, cents: number) => {
    if (cents <= 0) return
    perSeedKey.set(seedKey, (perSeedKey.get(seedKey) ?? 0) + cents)
  }

  for (const line of [...DEMO_INCOME, ...DEMO_INVESTMENTS, ...DEMO_FIXED, ...DEMO_VARIABLE]) {
    add(line.seedKey, line.medianCents)
  }

  for (const extra of DEMO_EXTRA_INCOME) {
    add('income-extra', Math.round(extra.cents / MONTHS_OF_HISTORY))
  }
  for (const lump of DEMO_LUMP_INVESTMENTS) {
    add(lump.seedKey, Math.round(lump.cents / MONTHS_OF_HISTORY))
  }

  const byCategory = new Map<string, number>()
  for (const [seedKey, cents] of perSeedKey) {
    const categoryId = categoryBySeedKey.get(seedKey)
    if (!categoryId) continue
    // Rounded to whole reais, because a household types round numbers into a
    // plan -- and it makes "over by R$ 43,12" obviously a real comparison.
    byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0) + Math.round(cents / 100) * 100)
  }

  return byCategory
}

/**
 * Written once, for the earliest month.
 *
 * One month only, deliberately: `resolveBudget` carries a budget forward to
 * every later month with no row of its own, so writing twenty-four months of
 * identical rows would both be redundant and quietly disable the
 * carry-forward this is meant to demonstrate.
 */
async function writePlans(ctx: Ctx): Promise<number> {
  const period = ctx.periods[0]
  const plans = demoPlanCents(ctx.categoryBySeedKey)

  for (const [categoryId, amountCents] of plans) {
    await setBudget(ctx.db, ctx.householdId, { categoryId, period, amountCents })
  }

  return plans.size
}

export type DemoResult = {
  transactions: number
  plans: number
  from: string
  to: string
}

/**
 * Writes the demo household. Idempotent: same ids, same figures, so running
 * it twice leaves exactly one demo dataset.
 */
export async function seedDemoData(
  db: Db,
  householdId: string,
  opts: { now?: Date } = {},
): Promise<DemoResult> {
  const now = opts.now ?? new Date()
  const current = saoPauloPeriod(now)
  const periods = Array.from({ length: MONTHS_OF_HISTORY }, (_, i) =>
    addMonths(current, i - (MONTHS_OF_HISTORY - 1)),
  )

  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.householdId, householdId))
    .limit(1)
  if (!owner) throw new Error('DEMO_NO_OWNER: the household has no user to own the connection.')

  const [connection] = await db
    .insert(connections)
    .values({
      householdId,
      ownerUserId: owner.id,
      pluggyItemId: DEMO_ITEM_ID,
      institution: DEMO_INSTITUTION,
      status: 'UPDATED',
      lastSyncedAt: now,
    })
    .onConflictDoUpdate({
      target: connections.pluggyItemId,
      // Refreshed so the demo connection never reads as stale, which would
      // put a "your data may be out of date" banner over data that is as
      // current as it will ever be.
      set: { lastSyncedAt: now, status: 'UPDATED' },
    })
    .returning({ id: connections.id })

  const account = async (
    suffix: string,
    type: 'CREDIT' | 'BANK',
    name: string,
    extra: Partial<typeof accounts.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(accounts)
      .values({
        connectionId: connection.id,
        pluggyAccountId: `${DEMO_ITEM_ID}-${suffix}`,
        type,
        name,
        last4: suffix === 'card' ? '4242' : '0001',
        ...extra,
      })
      .onConflictDoUpdate({ target: accounts.pluggyAccountId, set: { name } })
      .returning({ id: accounts.id })
    return row.id
  }

  const cardAccountId = await account('card', 'CREDIT', 'Cartão Demo', {
    dueDay: 10,
    closingDay: 3,
    creditLimitCents: 50_000_00,
  })
  const bankAccountId = await account('bank', 'BANK', 'Conta corrente Demo')

  const householdCategories = await db
    .select({ id: categories.id, seedKey: categories.seedKey })
    .from(categories)
    .where(eq(categories.householdId, householdId))

  const ctx: Ctx = {
    db,
    householdId,
    cardAccountId,
    bankAccountId,
    categoryBySeedKey: new Map(
      householdCategories.flatMap((c) => (c.seedKey ? [[c.seedKey, c.id] as const] : [])),
    ),
    periods,
    today: saoPauloPeriod(now),
    rng: mulberry32(20260823),
    rows: [],
  }

  for (const period of periods) {
    for (const line of DEMO_INCOME) writeLine(ctx, line, period, true)
    for (const line of DEMO_INVESTMENTS) writeLine(ctx, line, period, false)
    for (const line of DEMO_FIXED) writeLine(ctx, line, period, false)
    for (const line of DEMO_VARIABLE) writeLine(ctx, line, period, false)
  }

  for (const extra of DEMO_EXTRA_INCOME) {
    const period = addMonths(current, -extra.monthsAgo)
    if (!periods.includes(period)) continue
    push(ctx, {
      accountId: bankAccountId,
      date: dayIn(period, ctx.rng),
      amountCents: -extra.cents,
      description: extra.merchant,
      merchantRaw: extra.merchant,
      budgetRole: 'INCOME',
      ...categorize(ctx, { seedKey: 'income-extra', pluggyCategory: null }),
    })
  }

  for (const lump of DEMO_LUMP_INVESTMENTS) {
    const period = addMonths(current, -lump.monthsAgo)
    if (!periods.includes(period)) continue
    push(ctx, {
      accountId: bankAccountId,
      date: dayIn(period, ctx.rng),
      amountCents: lump.cents,
      description: lump.merchant,
      merchantRaw: lump.merchant,
      budgetRole: 'SPEND',
      ...categorize(ctx, { seedKey: lump.seedKey, pluggyCategory: null }),
    })
  }

  // Uncategorized rows in the last three months only. The inbox badge counts
  // all time, but a household looking at the inbox wants recent work, not a
  // two-year backlog it will never clear.
  for (const [index, descriptor] of DEMO_UNCATEGORIZED.entries()) {
    const period = addMonths(current, -(index % 3))
    push(ctx, {
      accountId: cardAccountId,
      date: dayIn(period, ctx.rng),
      amountCents: Math.round(50_00 + ctx.rng() * 900_00),
      description: descriptor,
      merchantRaw: descriptor,
      budgetRole: 'SPEND',
      pluggyCategory: null,
      categoryId: null,
      categorySource: null,
    })
  }

  writeInstalments(ctx)

  // Chunked: one INSERT with ~1,500 rows blows past the driver's parameter
  // limit, and the failure is an opaque protocol error rather than anything
  // that names the cause.
  for (let i = 0; i < ctx.rows.length; i += 200) {
    await db
      .insert(transactions)
      .values(ctx.rows.slice(i, i + 200))
      .onConflictDoUpdate({
        target: transactions.pluggyTransactionId,
        set: {
          date: sql`excluded.date`,
          amountCents: sql`excluded.amount_cents`,
          description: sql`excluded.description`,
          categoryId: sql`excluded.category_id`,
          budgetRole: sql`excluded.budget_role`,
          updatedAt: new Date(),
        },
      })
  }

  const plans = await writePlans(ctx)

  return {
    transactions: ctx.rows.length,
    plans,
    from: periods[0],
    to: periods[periods.length - 1],
  }
}

/**
 * Removes the demo dataset and nothing else.
 *
 * Transactions and accounts go with the connection, by cascade. Plans do not
 * hang off a connection, so they are matched by value: a plan still holding
 * the figure the demo wrote is the demo's and is removed, and a plan the
 * household has since edited is the household's and is kept. Recomputing
 * those figures is what the fixed RNG seed buys.
 */
export async function clearDemoData(
  db: Db,
  householdId: string,
  opts: { now?: Date } = {},
): Promise<{ removedTransactions: number; removedPlans: number }> {
  const [connection] = await db
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(eq(connections.householdId, householdId), eq(connections.pluggyItemId, DEMO_ITEM_ID)),
    )
    .limit(1)

  let removedTransactions = 0
  if (connection) {
    const [{ count }] = await db
      .select({ count: sql<string>`count(*)` })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(eq(accounts.connectionId, connection.id))
    removedTransactions = Number(count)

    await db.delete(connections).where(eq(connections.id, connection.id))
  }

  // Recompute what the demo would have written, then remove only the rows
  // that still match it exactly.
  const now = opts.now ?? new Date()
  const period = addMonths(saoPauloPeriod(now), -(MONTHS_OF_HISTORY - 1))
  const { start } = monthBounds(period)

  const existing = await db
    .select({
      id: budgets.id,
      categoryId: budgets.categoryId,
      amountCents: budgets.amountCents,
    })
    .from(budgets)
    .where(and(eq(budgets.householdId, householdId), eq(budgets.periodMonth, start)))

  const householdCategories = await db
    .select({ id: categories.id, seedKey: categories.seedKey })
    .from(categories)
    .where(eq(categories.householdId, householdId))

  const expected = demoPlanCents(
    new Map(householdCategories.flatMap((c) => (c.seedKey ? [[c.seedKey, c.id] as const] : []))),
  )

  const removable = existing
    .filter((row) => {
      // Still holding the figure the demo wrote, so it is the demo's. Edited,
      // and it is the household's now, whatever wrote it first.
      return expected.get(row.categoryId) === row.amountCents
    })
    .map((row) => row.id)

  if (removable.length > 0) {
    await db.delete(budgets).where(inArray(budgets.id, removable))
  }

  return { removedTransactions, removedPlans: removable.length }
}
