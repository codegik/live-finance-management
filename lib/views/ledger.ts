import type { Db } from '@/lib/db/client'
import { getHouseholdHealth, type HouseholdHealth } from '@/lib/db/health'
import { listHouseholdUsers } from '@/lib/db/households'
import { aggregateTransactions, listTransactions } from '@/lib/db/transactions'
import { countUncategorized } from '@/lib/views/inbox'

/**
 * How many transactions one ledger page holds. A statement of any age runs to
 * thousands of rows, and rendering them all is what made the page slow enough
 * to notice -- every row carries an inline category picker. 50 is a couple of
 * screenfuls: enough that scrolling still does most of the work, few enough
 * that the payload and the DOM stay small.
 */
export const LEDGER_PAGE_SIZE = 50

export type LedgerItem = {
  id: string
  description: string
  /** The normalized merchant the rule engine matches on, or null. Prefills the
   *  pattern when a rule is created from this row. */
  merchantNormalized: string | null
  amountCents: number
  institution: string
  accountLast4: string | null
  ownerName: string
  categoryId: string | null
  categoryName: string | null
}

export type LedgerDay = { date: string; totalCents: number; items: LedgerItem[] }

/** Where the current page sits in the full result set, for the page controls. */
export type LedgerPagination = {
  /** 1-based, always clamped into range even when the URL asks for page 999. */
  page: number
  pageSize: number
  /** Total matching rows across every page, not just the ones in `days`. */
  total: number
  /** Total pages, at least 1 so the footer can always say "página 1 de 1". */
  pageCount: number
  hasPrev: boolean
  hasNext: boolean
}

export type LedgerView = {
  health: HouseholdHealth
  days: LedgerDay[]
  uncategorizedCount: number
  includingExcluded: boolean
  /** The active search, trimmed, or null. Echoed back so the screen can say what it filtered by. */
  search: string | null
  /** Rows on THIS page, and their sum. Under a search these describe the matches only. */
  itemCount: number
  totalCents: number
  /**
   * Count and sum across EVERY page of the current filter, not just this one.
   * The search summary reads from these so "84 lançamentos · R$ 4.230" stays
   * true when the 84 span several pages; `itemCount`/`totalCents` still
   * describe only what is rendered below.
   */
  matchCount: number
  matchTotalCents: number
  pagination: LedgerPagination
}

export async function getLedgerView(
  db: Db,
  householdId: string,
  opts: {
    now?: Date
    includeExcluded?: boolean
    search?: string | null
    /** 1-based page; anything below 1 or non-finite is treated as page 1. */
    page?: number
    pageSize?: number
  } = {},
): Promise<LedgerView> {
  const includingExcluded = opts.includeExcluded ?? false
  // An empty or blank box is not a filter. Collapsing it to null here means
  // '?q=' and '?q=%20' behave exactly like no ?q at all, rather than becoming
  // a '%%' pattern that matches everything except rows with a NULL merchant.
  const search = opts.search?.trim() || null
  const pageSize = opts.pageSize ?? LEDGER_PAGE_SIZE
  const filter = { includeExcluded: includingExcluded, search }

  // The total is needed to clamp the page and size the "next" button, so it is
  // fetched alongside the rows rather than after -- a page number out of range
  // (a bookmark to page 9 of a statement since trimmed to 3) is pulled back to
  // the last real page instead of showing an empty list. The sum rides along:
  // it is the grand total the search summary shows.
  const { count: total, totalCents: matchTotalCents } = await aggregateTransactions(
    db,
    householdId,
    filter,
  )
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const requested = Math.floor(opts.page ?? 1)
  const page = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pageCount) : 1
  const offset = (page - 1) * pageSize

  const [rows, members, health, uncategorizedCount] = await Promise.all([
    listTransactions(db, householdId, { ...filter, limit: pageSize, offset }),
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
      merchantNormalized: row.merchantNormalized,
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
    matchCount: total,
    matchTotalCents,
    pagination: {
      page,
      pageSize,
      total,
      pageCount,
      hasPrev: page > 1,
      hasNext: page < pageCount,
    },
  }
}
