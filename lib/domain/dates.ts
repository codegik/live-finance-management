import { TZDate } from '@date-fns/tz'
import { format, subDays } from 'date-fns'

export const HOUSEHOLD_TIME_ZONE = 'America/Sao_Paulo'

/** Converts a Pluggy ISO timestamp into the household's calendar date. */
export function toSaoPauloDate(iso: string): string {
  return format(new TZDate(new Date(iso), HOUSEHOLD_TIME_ZONE), 'yyyy-MM-dd')
}

/** Calendar date N days before `reference`, in the household time zone. */
export function daysBefore(days: number, reference: Date): string {
  return format(subDays(new TZDate(reference, HOUSEHOLD_TIME_ZONE), days), 'yyyy-MM-dd')
}
