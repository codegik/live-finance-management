/**
 * A local development convenience: sign in as the seeded household without
 * typing anything, so `./start.sh` lands on a populated app rather than on a
 * login form.
 *
 * This is an authentication bypass, so it is written to fail closed. Every one
 * of the four conditions below must hold, and any of them being unreadable
 * counts as "no". The credentials are still checked against the database by
 * the ordinary credentials provider -- nothing here forges a session, it only
 * decides whether to submit a known local password on the user's behalf.
 *
 * Deliberately NOT part of lib/env.ts. That schema is what a deployment
 * validates at boot, and adding an autologin switch to it would put the switch
 * one typo away from existing in production. Read straight from the
 * environment here, where it is surrounded by the checks that make it safe.
 */

/** The account ./seed.sh creates. Fixed, local-only, and public in seed.sh. */
const DEFAULT_EMAIL = 'owner@localhost'
const DEFAULT_PASSWORD = 'localdev12345'

export type AutoLogin = { email: string; password: string }

function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    // An address that cannot be parsed cannot be shown to be local.
    return false
  }
}

/**
 * The credentials to auto-submit, or null when auto-login must not happen.
 *
 * `env` is a parameter rather than a direct `process.env` read so the four
 * refusals can be tested without mutating the process. Typed as a plain record
 * rather than NodeJS.ProcessEnv because that is all this reads -- and because
 * ProcessEnv requires NODE_ENV, which makes "the deploy that forgot to set
 * NODE_ENV", the case most worth testing, impossible to express.
 */
export function localAutoLogin(
  env: Record<string, string | undefined> = process.env,
): AutoLogin | null {
  // 1. Never in a production build, whatever else is set.
  if (env.NODE_ENV === 'production') return null
  // 2. Off unless switched on by name. Absent is off; so is any other value.
  if (env.LOCAL_AUTOLOGIN !== 'true') return null
  // 3. A local switch that reaches a real database is not a local switch.
  if (!isLocalDatabase(env.DATABASE_URL)) return null

  const email = (env.LOCAL_AUTOLOGIN_EMAIL ?? DEFAULT_EMAIL).trim()
  const password = env.LOCAL_AUTOLOGIN_PASSWORD ?? DEFAULT_PASSWORD

  // 4. Half a credential is not a credential.
  if (!email || !password) return null

  return { email, password }
}
