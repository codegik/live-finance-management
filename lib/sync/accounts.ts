import type { Db } from '@/lib/db/client'
import { accounts } from '@/lib/db/schema'
import type { PluggyClient } from '@/lib/pluggy/client'
import type { PluggyAccount } from '@/lib/pluggy/types'

function dueDayFrom(account: PluggyAccount): number | null {
  const date = account.creditData?.balanceDueDate
  if (!date) return null
  return Number(date.slice(8, 10))
}

/**
 * Brings the local accounts into line with what the bank login reports.
 *
 * Called on connect AND on every sync, because an account opened later on an
 * existing login would otherwise never appear -- with every transaction in
 * it. Being an upsert on pluggy_account_id, running it every sync is
 * idempotent and costs one request.
 *
 * It never deletes: an account that stops being reported keeps its history,
 * which is what the ledger is for.
 */
export async function refreshAccounts(
  db: Db,
  pluggy: PluggyClient,
  connectionId: string,
  itemId: string,
): Promise<{ upserted: number }> {
  const remoteAccounts = await pluggy.listAccounts(itemId)

  for (const remote of remoteAccounts) {
    await db
      .insert(accounts)
      .values({
        connectionId,
        pluggyAccountId: remote.id,
        type: remote.type,
        name: remote.name,
        last4: remote.number?.slice(-4) ?? null,
        dueDay: dueDayFrom(remote),
        // Pluggy's account payload has no closing-day field, only
        // creditData.balanceDueDate (the due day). This is structurally
        // always null, not a bug waiting to be found -- a household's own
        // override (closingDayOverride) is the only way this ever gets set.
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

  return { upserted: remoteAccounts.length }
}
