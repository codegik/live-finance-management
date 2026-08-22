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
    })
    .returning({ id: connections.id })

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
