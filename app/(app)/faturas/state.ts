import { z } from 'zod'

export type OverrideState = { error: string | null; message: string | null }

export const idSchema = z.string().uuid()
export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

export const OVERRIDE_SAVED_MESSAGE = 'Fatura informada.'
export const OVERRIDE_CLEARED_MESSAGE = 'Voltou para a estimativa.'
export const INVALID_AMOUNT_ERROR = 'Informe um valor válido, como 30.772,47.'
export const UNKNOWN_ACCOUNT_ERROR = 'Esse cartão não existe mais.'

/**
 * A pt-BR money string to centavos. "30.772,47" and "30772,47" and "30772.47"
 * and "30772" all mean the same thing; a comma is always the decimal separator
 * when present, and dots are then thousands. Returns null on anything that is
 * not a non-negative number.
 */
export function parseBrlToCents(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}
