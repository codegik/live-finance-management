/**
 * Kept out of actions.ts on purpose: a "use server" module may only export
 * async functions, so the shared state type and message live here.
 */
export type SignInState = { error: string | null }

export const CREDENTIALS_ERROR = 'Email or password is incorrect.'
