import type { Db } from '@/lib/db/client'
import { getHouseholdHealth, type HouseholdHealth } from '@/lib/db/health'
import { listHouseholdUsers } from '@/lib/db/households'
import { listTransactions } from '@/lib/db/transactions'

export type LedgerItem = {
  id: string
  description: string
  amountCents: number
  institution: string
  accountLast4: string | null
  ownerName: string
}

export type LedgerDay = { date: string; totalCents: number; items: LedgerItem[] }

export type LedgerView = { health: HouseholdHealth; days: LedgerDay[] }

export async function getLedgerView(
  db: Db,
  householdId: string,
  opts: { now?: Date } = {},
): Promise<LedgerView> {
  const [rows, members, health] = await Promise.all([
    listTransactions(db, householdId),
    listHouseholdUsers(db, householdId),
    getHouseholdHealth(db, householdId, opts),
  ])

  const nameByUserId = new Map(members.map((m) => [m.id, m.name]))
  const byDate = new Map<string, LedgerDay>()

  for (const row of rows) {
    const day = byDate.get(row.date) ?? { date: row.date, totalCents: 0, items: [] }
    day.totalCents += row.amountCents
    day.items.push({
      id: row.id,
      description: row.description,
      amountCents: row.amountCents,
      institution: row.institution,
      accountLast4: row.accountLast4,
      ownerName: nameByUserId.get(row.ownerUserId) ?? 'Unknown',
    })
    byDate.set(row.date, day)
  }

  return {
    health,
    days: [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)),
  }
}
