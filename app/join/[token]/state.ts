/**
 * Kept out of actions.ts on purpose: a "use server" module may only export
 * async functions, so the shared state type and messages live here.
 */
export type JoinState = { error: string | null }

export const INVALID_INVITE_ERROR = 'This invite link is no longer valid. Ask for a new one.'
export const SHORT_PASSWORD_ERROR = 'Choose a password of at least 8 characters.'
