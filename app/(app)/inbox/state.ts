/**
 * Kept out of actions.ts on purpose: a "use server" module may only export
 * async functions, so the shared state type and messages live here.
 */
export type AssignState = { error: string | null; message: string | null }

export const ASSIGNED_MESSAGE = 'Categorized'
export const MISSING_FIELD_ERROR = 'Choose a category first.'
export const UNKNOWN_MERCHANT_ERROR = 'That merchant is no longer in the inbox.'
