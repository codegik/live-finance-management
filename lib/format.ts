/**
 * Every figure the household reads, formatted in one place.
 *
 * Four screens had their own `new Intl.NumberFormat('pt-BR', ...)` and the
 * constructor is not cheap; more to the point, a fifth would eventually be
 * built with different options and the same month would print two ways.
 */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Thousands only, no centavos: the year grid has twelve columns to fit. */
const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const MONTH_LONG = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' })
const MONTH_SHORT = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })

export function brl(cents: number): string {
  // Belt and braces against `-0`, which Intl renders as "-R$ 0,00". The views
  // normalise it at the source (toActualCents); this catches any figure that
  // reaches a screen by some other route -- a subtraction that lands on zero,
  // for instance.
  return BRL.format(cents === 0 ? 0 : cents / 100)
}

/** `-` rather than `0` for an empty cell: a grid of zeroes hides its own data. */
export function brlCompact(cents: number): string {
  if (cents === 0) return '—'
  return BRL_COMPACT.format(Math.round(cents / 100))
}

/** A signed figure, always carrying its sign, for a difference against a plan. */
export function brlSigned(cents: number): string {
  return `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${BRL.format(Math.abs(cents) / 100)}`
}

/**
 * `YYYY-MM` as a UTC instant. UTC on purpose: this is a label for a calendar
 * month that was already bucketed to America/Sao_Paulo at ingest, and
 * re-applying a zone here is how "2026-01" renders as December.
 */
function periodDate(period: string): Date {
  const [year, month] = period.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 1))
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** `Agosto de 2026`. */
export function monthLabel(period: string): string {
  return `${capitalize(MONTH_LONG.format(periodDate(period)))} de ${period.slice(0, 4)}`
}

/** `Ago`, for a column header or a month strip. */
export function monthShort(period: string): string {
  return capitalize(MONTH_SHORT.format(periodDate(period)).replace('.', ''))
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/**
 * The account a charge sits on, compressed to what a phone screen can hold.
 *
 * The full "LATAM PASS ITAU MASTERCARD BLACK ···· 1885" is a marketing name
 * that eats the whole row on mobile and then truncates -- dropping the very
 * digits and instalment that identify the charge. A card is named by its last
 * four; a bank by its own short name (first word only, so "Banco do Brasil"
 * is "Banco") and the same four. Enough to tell one account from another
 * without spending the width the amount needs.
 */
export function accountLabel(input: {
  type: 'CREDIT' | 'BANK'
  institution: string
  last4: string | null
}): string {
  const tail = input.last4 ? ` ···· ${input.last4}` : ''
  if (input.type === 'CREDIT') return `Cartão${tail}`
  return `${input.institution.split(' ')[0]}${tail}`
}
