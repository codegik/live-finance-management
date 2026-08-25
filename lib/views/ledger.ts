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
  categoryId: string | null
  categoryName: string | null
}

export type LedgerDay = { date: string; totalCents: number; items: LedgerItem[] }

export type LedgerView = {
  health: HouseholdHealth
  days: LedgerDay[]
  uncategorizedCount: number
  includingExcluded: boolean
  /** The active search, trimmed, or null. Echoed back so the screen can say what it filtered by. */
  search: string | null
  /** Rows in `days`, and their sum. Under a search these describe the matches only. */
  itemCount: number
  totalCents: number
}

export async function getLedgerView(
  db: Db,
  householdId: string,
  opts: { now?: Date; includeExcluded?: boolean; search?: string | null } = {},
): Promise<LedgerView> {
  const includingExcluded = opts.includeExcluded ?? false
  // An empty or blank box is not a filter. Collapsing it to null here means
  // '?q=' and '?q=%20' behave exactly like no ?q at all, rather than becoming
  // a '%%' pattern that matches everything except rows with a NULL merchant.
  const search = opts.search?.trim() || null

  const [rows, members, health, uncategorizedCount] = await Promise.all([
    listTransactions(db, householdId, { includeExcluded: includingExcluded, search }),
    listHouseholdUsers(db, householdId),
    getHouseholdHealth(db, householdId, opts),
    // Deliberately NOT filtered by the search. This is the badge linking to
    // the inbox -- it answers "how much is still waiting", a question about
    // the household, not about the current filter. Narrowing it would make
    // the backlog appear to shrink as someone typed.
    countUncategorized(db, householdId),
  ])

  const nameByUserId = new Map(members.map((m) => [m.id, m.name]))
  const byDate = new Map<string, LedgerDay>()
  let totalCents = 0

  for (const row of rows) {
    const day = byDate.get(row.date) ?? { date: row.date, totalCents: 0, items: [] }
    // Summed from the rows actually listed, which under a search are only the
    // matches. A day header totalling the whole day above a filtered list is a
    // screen that contradicts itself: the reader adds up what they can see,
    // gets a different number, and stops trusting both.
    day.totalCents += row.amountCents
    totalCents += row.amountCents
    day.items.push({
      id: row.id,
      description: row.description,
      amountCents: row.amountCents,
      institution: row.institution,
      accountLast4: row.accountLast4,
      ownerName: nameByUserId.get(row.ownerUserId) ?? 'Unknown',
      categoryId: row.categoryId,
      categoryName: row.categoryName,
    })
    byDate.set(row.date, day)
  }

  return {
    health,
    days: [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)),
    uncategorizedCount,
    includingExcluded,
    search,
    itemCount: rows.length,
    totalCents,
  }
}
