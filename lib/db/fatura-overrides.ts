import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from './client'
import { accounts, connections, faturaOverrides } from './schema'

/** True when the account is one of this household's, so a set/clear from
 *  another household touches nothing. Same scoping idea as setAccountDays. */
async function accountBelongsToHousehold(
  db: Db,
  householdId: string,
  accountId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(and(eq(accounts.id, accountId), eq(connections.householdId, householdId)))
    .limit(1)
  return Boolean(row)
}

/**
 * Sets (or replaces) the household's own total for a card's open fatura. One per
 * (account, period): re-entering it updates in place. Returns false when the
 * account is not this household's, which the caller reports as "unknown".
 */
export async function setFaturaOverride(
  db: Db,
  householdId: string,
  accountId: string,
  period: string,
  totalAmountCents: number,
): Promise<{ ok: boolean }> {
  if (!(await accountBelongsToHousehold(db, householdId, accountId))) return { ok: false }

  await db
    .insert(faturaOverrides)
    .values({ accountId, period, totalAmountCents })
    .onConflictDoUpdate({
      target: [faturaOverrides.accountId, faturaOverrides.period],
      set: { totalAmountCents, updatedAt: new Date() },
    })
  return { ok: true }
}

/** Removes the household's override for a card's fatura, falling the row back to
 *  the transaction estimate (or the bill, once one lands). */
export async function clearFaturaOverride(
  db: Db,
  householdId: string,
  accountId: string,
  period: string,
): Promise<{ ok: boolean }> {
  if (!(await accountBelongsToHousehold(db, householdId, accountId))) return { ok: false }

  await db
    .delete(faturaOverrides)
    .where(and(eq(faturaOverrides.accountId, accountId), eq(faturaOverrides.period, period)))
  return { ok: true }
}

/** Every override on the household's cards, as a Map keyed `accountId:YYYY-MM`. */
export async function listFaturaOverrides(
  db: Db,
  householdId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      accountId: faturaOverrides.accountId,
      period: faturaOverrides.period,
      totalAmountCents: faturaOverrides.totalAmountCents,
    })
    .from(faturaOverrides)
    .innerJoin(accounts, eq(faturaOverrides.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(eq(connections.householdId, householdId))

  return new Map(rows.map((r) => [`${r.accountId}:${r.period.slice(0, 7)}`, r.totalAmountCents]))
}
