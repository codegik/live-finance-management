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
