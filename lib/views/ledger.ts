import type { Db } from '@/lib/db/client'
import { getHouseholdHealth, type HouseholdHealth } from '@/lib/db/health'
import { listHouseholdUsers } from '@/lib/db/households'
import { listTransactions } from '@/lib/db/transactions'
import { countUncategorized } from '@/lib/views/inbox'

export type LedgerItem = {
  id: string
  description: string
  amountCents: number
  institution: string
  accountLast4: string | null
  ownerName: string
  categoryName: string | null
}

export type LedgerDay = { date: string; totalCents: number; items: LedgerItem[] }

export type LedgerView = { health: HouseholdHealth; days: LedgerDay[]; uncategorizedCount: number }

export async function getLedgerView(
  db: Db,
  householdId: string,
  opts: { now?: Date } = {},
): Promise<LedgerView> {
  const [rows, members, health, uncategorizedCount] = await Promise.all([
    listTransactions(db, householdId),
    listHouseholdUsers(db, householdId),
    getHouseholdHealth(db, householdId, opts),
    countUncategorized(db, householdId),
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
      categoryName: row.categoryName,
    })
    byDate.set(row.date, day)
  }

  return {
    health,
    days: [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)),
    uncategorizedCount,
  }
}
