/**
 * Kept out of actions.ts on purpose: a "use server" module may only export
 * async functions, so the shared state type and messages live here.
 */
export type AssignState = { error: string | null; message: string | null }

export const ASSIGNED_MESSAGE = 'Categorized'
export const MISSING_FIELD_ERROR = 'Choose a category first.'
export const EMPTY_PATTERN_ERROR = 'That pattern has no letters or numbers to match on.'

// Shared with the settings screens: a forged categoryId maps to the same
// friendly message wherever it is caught.
export { UNKNOWN_CATEGORY_ERROR } from '@/app/(app)/settings/categories/state'
