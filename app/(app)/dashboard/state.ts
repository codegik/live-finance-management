/**
 * Split from actions.ts because a 'use server' module may export nothing but
 * async functions -- a constant or a type there fails the build outright. The
 * settings and inbox screens are split the same way, for the same reason.
 */
export type RecategorizeState = { error: string | null; message: string | null }

export const MOVED_MESSAGE = 'Movido.'
export const UNKNOWN_TRANSACTION_ERROR = 'Esse lançamento não existe mais.'
export const UNKNOWN_CATEGORY_ERROR = 'Essa categoria não existe mais.'
