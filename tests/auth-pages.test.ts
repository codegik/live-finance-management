import { CredentialsSignin } from 'next-auth'
import { beforeEach, expect, it, vi } from 'vitest'

// Only next-auth's signIn is faked: it needs a real request scope (cookies,
// headers) that no integration test has. The action's own failure handling --
// which is what was missing -- runs for real.
const state = vi.hoisted(() => ({
  signIn: (async () => {}) as (...args: unknown[]) => Promise<unknown>,
}))

vi.mock('@/lib/auth/session', () => ({
  signIn: (...args: unknown[]) => state.signIn(...args),
}))

import { joinAction } from '@/app/join/[token]/actions'
import { INVALID_INVITE_ERROR, SHORT_PASSWORD_ERROR } from '@/app/join/[token]/state'
import { signInAction } from '@/app/signin/actions'
import { CREDENTIALS_ERROR } from '@/app/signin/state'
import { authorizeCredentials } from '@/lib/auth/config'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { createInvite } from '@/lib/db/invites'
import { resetDb, testDb, useTestEnv } from './helpers/db'

beforeEach(async () => {
  useTestEnv()
  state.signIn = async () => undefined
  await resetDb()
})

function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.append(key, value)
  return data
}

/** next/navigation's redirect() throws a digest-tagged error. */
function redirectError(to: string): Error {
  return Object.assign(new Error('NEXT_REDIRECT'), {
    digest: `NEXT_REDIRECT;replace;${to};307;`,
  })
}

async function digestOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run()
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest
    return typeof digest === 'string' ? digest : undefined
  }
  return undefined
}

// --- sign in -----------------------------------------------------------------

it('returns a form error instead of a 500 when the password is wrong', async () => {
  state.signIn = async () => {
    throw new CredentialsSignin()
  }

  const result = await signInAction({ error: null }, form({ email: 'a@b.com', password: 'nope' }))

  expect(result).toEqual({ error: CREDENTIALS_ERROR })
})

it('lets the successful sign-in redirect through the catch', async () => {
  // signIn with redirectTo signals success by THROWING NEXT_REDIRECT. A catch
  // that swallowed it would strand a correctly authenticated user on /signin.
  state.signIn = async () => {
    throw redirectError('/ledger')
  }

  const digest = await digestOf(() =>
    signInAction({ error: null }, form({ email: 'a@b.com', password: 'right' })),
  )

  expect(digest).toMatch(/^NEXT_REDIRECT;replace;\/ledger;/)
})

it('does not disguise a real server failure as bad credentials', async () => {
  const boom = new Error('DB_CONNECTION_LOST')
  state.signIn = async () => {
    throw boom
  }

  await expect(
    signInAction({ error: null }, form({ email: 'a@b.com', password: 'right' })),
  ).rejects.toBe(boom)
})

// --- join --------------------------------------------------------------------

it('returns a form error instead of a 500 for an invalid invite token', async () => {
  const result = await joinAction('not-a-real-token', { error: null }, form({ password: 'a-good-password' }))

  expect(result).toEqual({ error: INVALID_INVITE_ERROR })
})

it('returns a form error for a used invite token rather than throwing', async () => {
  const db = testDb()
  const { householdId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const { token } = await createInvite(db, {
    householdId,
    email: 'wife@example.com',
    name: 'Wife',
  })

  const digest = await digestOf(() =>
    joinAction(token, { error: null }, form({ password: 'her own password' })),
  )
  expect(digest).toMatch(/^NEXT_REDIRECT;replace;\/signin;/)

  const second = await joinAction(token, { error: null }, form({ password: 'another password' }))
  expect(second).toEqual({ error: INVALID_INVITE_ERROR })

  // The first redemption really happened -- the error state above is the
  // second attempt failing, not the whole flow being broken.
  const signedIn = await authorizeCredentials(db, {
    email: 'wife@example.com',
    password: 'her own password',
  })
  expect(signedIn?.householdId).toBe(householdId)
})

it('rejects a too-short password without touching the invite', async () => {
  const db = testDb()
  const { householdId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const { token } = await createInvite(db, {
    householdId,
    email: 'wife@example.com',
    name: 'Wife',
  })

  const result = await joinAction(token, { error: null }, form({ password: 'short' }))
  expect(result).toEqual({ error: SHORT_PASSWORD_ERROR })

  // The invite must survive so the invitee can try again.
  const redeemed = await digestOf(() =>
    joinAction(token, { error: null }, form({ password: 'a-long-enough-password' })),
  )
  expect(redeemed).toMatch(/^NEXT_REDIRECT;replace;\/signin;/)
})
