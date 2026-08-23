import type { AlertCrossing } from '@/lib/domain/alerts'

/**
 * One message per evaluation, listing every crossing. Per-category messages
 * were rejected deliberately: one supermarket trip can cross several
 * thresholds, and four mails from one shopping trip teach a household to mute
 * the sender.
 *
 * Plain text only. An alert is four lines of numbers; HTML would add a
 * rendering surface and no information.
 */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function formatCents(cents: number): string {
  return brl.format(cents / 100)
}

/** `2026-08` as `August 2026`. */
function formatPeriod(period: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${period}-01T00:00:00Z`))
}

export function renderAlertEmail(
  crossings: AlertCrossing[],
  period: string,
): { subject: string; text: string } {
  const distinct = new Set(crossings.map((c) => c.categoryId))

  // crossings arrive sorted with the highest threshold first, so [0] is the
  // most serious line about the only category when there is only one.
  const subject =
    distinct.size === 1
      ? `${crossings[0].categoryName} is at ${crossings[0].threshold}% of its budget`
      : `${distinct.size} categories crossed a budget threshold`

  const lines = crossings.map((c) => {
    // Floor, not round: 99.6% of a budget must not be reported as 100%.
    const percent = Math.floor((c.spentCents * 100) / c.budgetCents)
    return `${c.categoryName} — ${formatCents(c.spentCents)} of ${formatCents(c.budgetCents)} (${percent}%)`
  })

  return { subject, text: `${formatPeriod(period)}\n\n${lines.join('\n')}\n` }
}
