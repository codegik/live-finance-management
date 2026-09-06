/**
 * Split from actions.ts because a 'use server' module may export nothing but
 * async functions -- a constant or a type there fails the build outright. The
 * settings and inbox screens are split the same way, for the same reason.
 */
export type RecategorizeState = { error: string | null; message: string | null }

export const MOVED_MESSAGE = 'Movido.'
export const UNKNOWN_TRANSACTION_ERROR = 'Esse lançamento não existe mais.'
export const UNKNOWN_CATEGORY_ERROR = 'Essa categoria não existe mais.'

/** State for the inline plan editor on each category row. */
export type PlanState = { error: string | null; message: string | null }

export const PLAN_SAVED_MESSAGE = 'Plano salvo.'
export const PLAN_CLEARED_MESSAGE = 'Plano removido.'
export const INVALID_AMOUNT_ERROR = 'Valor inválido.'
export const INVALID_PERIOD_ERROR = 'Mês inválido.'

/** State for the merchant-label modal (set / clear a household's own name). */
export type MerchantLabelState = { error: string | null; message: string | null }

export const LABEL_SAVED_MESSAGE = 'Apelido salvo.'
export const LABEL_CLEARED_MESSAGE = 'Apelido removido.'
export const EMPTY_LABEL_ERROR = 'Digite um apelido.'
export const UNKNOWN_MERCHANT_ERROR = 'Esse lançamento não tem um estabelecimento para apelidar.'

/** State for the recurring-expense modal (set / clear a repeating expense). */
export type RecurringExpenseState = { error: string | null; message: string | null }

export const RECURRING_SAVED_MESSAGE = 'Recorrência salva.'
export const RECURRING_CLEARED_MESSAGE = 'Recorrência removida.'
export const EMPTY_RECURRING_TITLE_ERROR = 'Dê um nome à recorrência.'
export const INVALID_DAY_ERROR = 'Dia inválido.'
/** Reused for a pattern that has nothing to match on: same cause as a label. */
export const RECURRING_NO_MERCHANT_ERROR =
  'Esse lançamento não tem um estabelecimento para tornar recorrente.'
