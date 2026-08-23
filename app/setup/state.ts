/**
 * Kept out of actions.ts on purpose: a "use server" module may only export
 * async functions, so the shared state type and messages live here.
 */
export type SetupState = { error: string | null }

export const HOUSEHOLD_EXISTS_ERROR =
  'This app has already been set up. Sign in instead.'
export const SHORT_PASSWORD_ERROR = 'Choose a password of at least 8 characters.'
export const MISSING_FIELD_ERROR = 'Fill in every field.'
export const INVALID_EMAIL_ERROR = 'That does not look like an email address.'
