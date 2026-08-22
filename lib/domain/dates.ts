import { TZDate } from '@date-fns/tz'
import { format, subDays } from 'date-fns'

export const HOUSEHOLD_TIME_ZONE = 'America/Sao_Paulo'

/**
 * A bare calendar date, or an ISO string whose time component is exactly
 * midnight UTC (spelled with a `Z` or an explicit `+00:00` offset). Pluggy
 * commonly reports credit-card transactions this way: the issuer only knows
 * the calendar date, and the API either omits the time entirely or pads it
 * to UTC midnight.
 */
const UTC_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0+)?(?:Z|\+00:00))?$/

/**
 * Converts a Pluggy timestamp into the household's calendar date.
 *
 * A bare date, or a value at exactly UTC midnight (`Z` or `+00:00`), is
 * treated as a DATE-ONLY value and its leading 10 characters are taken
 * unchanged -- no timezone conversion. Everything else is a true instant and
 * is converted through the IANA zone.
 *
 * VERIFY AGAINST REAL DATA before production: does Pluggy's `date` carry a
 * real local time-of-day, or is it a calendar date (bare, or padded to UTC
 * midnight)? The repo cannot answer that, so this rules on asymmetric risk.
 * If Pluggy sends date-padded values, this is correct and converting instead
 * would shift EVERY transaction one day early (and every transaction on the
 * 1st into the previous month) -- systematic, invisible corruption. The
 * residual risk after this change is narrow: a genuine instant that happens
 * to land exactly on UTC midnight (21:00 the previous day in Sao Paulo)
 * mis-buckets that one rare transaction a day late -- bounded and visible.
 * Wrong in the cheap direction beats wrong in the catastrophic one.
 */
export function toSaoPauloDate(iso: string): string {
  const dateOnly = UTC_MIDNIGHT.exec(iso)
  if (dateOnly) return dateOnly[1]

  return format(new TZDate(new Date(iso), HOUSEHOLD_TIME_ZONE), 'yyyy-MM-dd')
}

/** Calendar date N days before `reference`, in the household time zone. */
export function daysBefore(days: number, reference: Date): string {
  return format(subDays(new TZDate(reference, HOUSEHOLD_TIME_ZONE), days), 'yyyy-MM-dd')
}
