'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { addMonths } from '@/lib/domain/budget'
import { monthShort } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Moving between months, which is the whole point of the screen.
 *
 * Plain links and no client state, the way the ledger's transfer toggle
 * works: the month is in the URL, so a month is shareable, bookmarkable and
 * survives a reload. The arrows deliberately cross the year boundary --
 * `addMonths` handles it -- so December and January are one step apart rather
 * than a dead end at the edge of the strip.
 */
export function MonthNav({
  period,
  currentPeriod,
  basePath = '/dashboard',
}: {
  period: string
  currentPeriod: string
  basePath?: string
}) {
  const year = period.slice(0, 4)
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)

  // The strip scrolls on a phone, where only a handful of months fit at once.
  // A selected month sitting off the right edge (Set, Out, Nov, Dez) would be
  // invisible unless we bring it into view -- so centre the active month in the
  // scroller whenever the period changes.
  // Depend on `period`: the arrows are client-side soft navigations, so this
  // component re-renders with a new period rather than remounting -- an
  // effect that ran only on mount would leave December scrolled off the edge.
  const activeRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [period])

  return (
    <div className="flex items-center gap-2">
      <Link
        className={buttonVariants({ variant: 'outline', size: 'icon', className: 'shrink-0' })}
        href={`${basePath}?period=${addMonths(period, -1)}`}
        aria-label="Mês anterior"
      >
        <ChevronLeft className="size-4" />
      </Link>

      <div className="flex flex-1 gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
        {months.map((month) => {
          const isCurrent = month === period
          const isToday = month === currentPeriod
          return (
            <Link
              key={month}
              ref={isCurrent ? activeRef : undefined}
              href={`${basePath}?period=${month}`}
              aria-current={isCurrent ? 'page' : undefined}
              className={cn(
                'flex-1 rounded-md px-2 py-1.5 text-center text-sm font-medium capitalize transition-colors',
                isCurrent
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                !isCurrent && isToday && 'ring-1 ring-inset ring-accent-blue/50',
              )}
            >
              {monthShort(month)}
            </Link>
          )
        })}
      </div>

      <Link
        className={buttonVariants({ variant: 'outline', size: 'icon', className: 'shrink-0' })}
        href={`${basePath}?period=${addMonths(period, 1)}`}
        aria-label="Próximo mês"
      >
        <ChevronRight className="size-4" />
      </Link>
    </div>
  )
}
