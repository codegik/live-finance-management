import { TZDate } from '@date-fns/tz'
import { format, subDays } from 'date-fns'

export const HOUSEHOLD_TIME_ZONE = 'America/Sao_Paulo'

/** A bare calendar date, with no time component to interpret. */
const BARE_DATE = /^(\d{4}-\d{2}-\d{2})$/

/**
 * Converts a Pluggy timestamp into the household's calendar date.
 *
 * VERIFIED AGAINST REAL DATA (a live credit-card payload, 500 transactions):
 * Pluggy pads a date-only value to LOCAL midnight expressed in UTC — the
 * dominant time-of-day is `03:00:00.000Z`, which is exactly midnight in São
 * Paulo — and otherwise carries a real time of day. Both cases therefore want
 * the same thing: a straight conversion through the IANA zone.
 *
 * An earlier version special-cased exact UTC midnight as date-only, chosen
 * defensively before real data was available. That payload shows no
 * transaction using that spelling, so the special case never fired — and,
 * since Pluggy pads to 03:00Z rather than 00:00Z, a genuine `00:00:00Z` is
 * far more likely to be a real instant (21:00 the previous day here) than a
 * calendar date. Converting it is the honest reading.
 *
 * A bare `YYYY-MM-DD` is still taken as-is: it carries no time of day at all,
 * so there is nothing to convert and no way for the conversion to be right.
 */
export function toSaoPauloDate(iso: string): string {
  const bare = BARE_DATE.exec(iso)
  if (bare) return bare[1]

  return format(new TZDate(new Date(iso), HOUSEHOLD_TIME_ZONE), 'yyyy-MM-dd')
}

/** Calendar date N days before `reference`, in the household time zone. */
export function daysBefore(days: number, reference: Date): string {
  return format(subDays(new TZDate(reference, HOUSEHOLD_TIME_ZONE), days), 'yyyy-MM-dd')
}
