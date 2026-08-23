import { beforeEach, expect, it } from 'vitest'
import { setupAction } from '@/app/setup/actions'
import {
  HOUSEHOLD_EXISTS_ERROR,
  INVALID_EMAIL_ERROR,
  MISSING_FIELD_ERROR,
  SHORT_PASSWORD_ERROR,
} from '@/app/setup/state'
import { authorizeCredentials } from '@/lib/auth/config'
import { countHouseholds, createHousehold } from '@/lib/db/households'
import { resetDb, testDb, useTestEnv } from './helpers/db'

beforeEach(async () => {
  useTestEnv()
  await resetDb()
})

function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.append(key, value)
  return data
}

const valid = {
  householdName: 'Klassmann',
  name: 'Inacio',
  email: 'inacio@example.com',
  password: 'a-real-password',
}

/** next/navigation's redirect() signals by throwing a digest-tagged error. */
async function digestOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run()
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest
    return typeof digest === 'string' ? digest : undefined
  }
  return undefined
}

it('creates the household and redirects to sign in', async () => {
  const digest = await digestOf(() => setupAction({ error: null }, form(valid)))

  expect(digest).toMatch(/^NEXT_REDIRECT;replace;\/signin;/)
  expect(await countHouseholds(testDb())).toBe(1)

  const session = await authorizeCredentials(testDb(), {
    email: valid.email,
    password: valid.password,
  })
  expect(session).not.toBeNull()
})

it('returns a form error instead of a 500 once a household exists', async () => {
  await createHousehold(testDb(), {
    name: 'Existing',
    owner: { email: 'someone@example.com', name: 'Someone', passwordHash: 'hash' },
  })

  const result = await setupAction({ error: null }, form(valid))

  expect(result).toEqual({ error: HOUSEHOLD_EXISTS_ERROR })
  expect(await countHouseholds(testDb())).toBe(1)
})

it('rejects a short password before writing anything', async () => {
  const result = await setupAction({ error: null }, form({ ...valid, password: 'short' }))

  expect(result).toEqual({ error: SHORT_PASSWORD_ERROR })
  expect(await countHouseholds(testDb())).toBe(0)
})

it('rejects a missing field before writing anything', async () => {
  const result = await setupAction({ error: null }, form({ ...valid, householdName: '   ' }))

  expect(result).toEqual({ error: MISSING_FIELD_ERROR })
  expect(await countHouseholds(testDb())).toBe(0)
})

it('rejects an email that is not one', async () => {
  const result = await setupAction({ error: null }, form({ ...valid, email: 'not-an-email' }))

  expect(result).toEqual({ error: INVALID_EMAIL_ERROR })
  expect(await countHouseholds(testDb())).toBe(0)
})
