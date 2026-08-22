import { eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { accounts, connections } from '@/lib/db/schema'
import type { PluggyClient } from '@/lib/pluggy/client'
import type { PluggyAccount } from '@/lib/pluggy/types'

function dueDayFrom(account: PluggyAccount): number | null {
  const date = account.creditData?.balanceDueDate
  if (!date) return null
  return Number(date.slice(8, 10))
}

export async function attachConnection(
  db: Db,
  pluggy: PluggyClient,
  input: { householdId: string; ownerUserId: string; itemId: string },
): Promise<{ connectionId: string }> {
  // pluggy_item_id is globally unique with no household component, so an
  // upsert on it alone lets a session in household A rewrite household B's
  // connection row by posting B's itemId. Every read path is scoped; this is
  // the only write that could cross the boundary. Refuse it outright, and
  // scope the conflict update too so the guard is enforced in SQL as well.
  const [existing] = await db
    .select({ householdId: connections.householdId })
    .from(connections)
    .where(eq(connections.pluggyItemId, input.itemId))
    .limit(1)

  if (existing && existing.householdId !== input.householdId) {
    throw new Error('CONNECTION_OWNED_BY_ANOTHER_HOUSEHOLD')
  }

  const item = await pluggy.getItem(input.itemId)
  const remoteAccounts = await pluggy.listAccounts(input.itemId)

  const [connection] = await db
    .insert(connections)
    .values({
      householdId: input.householdId,
      ownerUserId: input.ownerUserId,
      pluggyItemId: item.id,
      institution: item.connector.name,
      status: item.status,
    })
    .onConflictDoUpdate({
      target: connections.pluggyItemId,
      set: { institution: item.connector.name, status: item.status },
      // `setWhere` is the DO UPDATE ... WHERE predicate: the update only
      // touches a row that already belongs to this household.
      setWhere: eq(connections.householdId, input.householdId),
    })
    .returning({ id: connections.id })

  // The conflict predicate can match nothing (a row that raced in between the
  // check above and this insert), in which case the upsert is a no-op and
  // returns no row. Never continue as if it had worked.
  if (!connection) throw new Error('CONNECTION_OWNED_BY_ANOTHER_HOUSEHOLD')

  for (const remote of remoteAccounts) {
    await db
      .insert(accounts)
      .values({
        connectionId: connection.id,
        pluggyAccountId: remote.id,
        type: remote.type,
        name: remote.name,
        last4: remote.number?.slice(-4) ?? null,
        dueDay: dueDayFrom(remote),
        closingDay: null,
        creditLimitCents:
          remote.creditData?.creditLimit == null
            ? null
            : Math.round(remote.creditData.creditLimit * 100),
      })
      .onConflictDoUpdate({
        target: accounts.pluggyAccountId,
        set: { name: remote.name, dueDay: dueDayFrom(remote) },
      })
  }

  return { connectionId: connection.id }
}
