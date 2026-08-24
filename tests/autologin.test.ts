import { expect, it } from 'vitest'
import { localAutoLogin } from '@/lib/demo/autologin'

/**
 * This is an authentication bypass. Every test here is about it being OFF:
 * the one case where it should be on is a convenience, and the cases where it
 * must not be are the whole reason the function has four conditions instead of
 * one. A regression that turns it on is not a broken feature, it is an open
 * door.
 */
const LOCAL: Record<string, string | undefined> = {
  NODE_ENV: 'development',
  LOCAL_AUTOLOGIN: 'true',
  DATABASE_URL: 'postgres://u:p@localhost:5432/finance',
}

it('signs in as the seeded account when every local condition holds', () => {
  expect(localAutoLogin(LOCAL)).toEqual({
    email: 'owner@localhost',
    password: 'localdev12345',
  })
})

it('is off in a production build even with the switch on and a local database', () => {
  expect(localAutoLogin({ ...LOCAL, NODE_ENV: 'production' })).toBeNull()
})

it('is off unless the switch is exactly "true"', () => {
  // Absent, and every near-miss a shell or a copied line might produce.
  expect(localAutoLogin({ ...LOCAL, LOCAL_AUTOLOGIN: undefined })).toBeNull()
  expect(localAutoLogin({ ...LOCAL, LOCAL_AUTOLOGIN: '' })).toBeNull()
  expect(localAutoLogin({ ...LOCAL, LOCAL_AUTOLOGIN: '1' })).toBeNull()
  expect(localAutoLogin({ ...LOCAL, LOCAL_AUTOLOGIN: 'TRUE' })).toBeNull()
  expect(localAutoLogin({ ...LOCAL, LOCAL_AUTOLOGIN: 'yes' })).toBeNull()
  expect(localAutoLogin({ ...LOCAL, LOCAL_AUTOLOGIN: 'false' })).toBeNull()
})

it('is off when the database is not on this machine, however local the switch claims to be', () => {
  // The dangerous case: someone copies .env.local onto a server, or points a
  // local checkout at the production database to debug something.
  expect(
    localAutoLogin({ ...LOCAL, DATABASE_URL: 'postgres://u:p@db.railway.app:5432/finance' }),
  ).toBeNull()
  expect(localAutoLogin({ ...LOCAL, DATABASE_URL: 'postgres://u:p@10.0.0.4:5432/finance' })).toBeNull()
})

it('fails closed on a database URL it cannot read', () => {
  expect(localAutoLogin({ ...LOCAL, DATABASE_URL: undefined })).toBeNull()
  expect(localAutoLogin({ ...LOCAL, DATABASE_URL: 'not a url' })).toBeNull()
})

it('accepts the loopback addresses as local', () => {
  expect(localAutoLogin({ ...LOCAL, DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/f' })).not.toBeNull()
})

it('refuses half a credential rather than signing in with a blank one', () => {
  expect(localAutoLogin({ ...LOCAL, LOCAL_AUTOLOGIN_EMAIL: '   ' })).toBeNull()
  expect(localAutoLogin({ ...LOCAL, LOCAL_AUTOLOGIN_PASSWORD: '' })).toBeNull()
})

it('lets a developer point it at their own account', () => {
  expect(
    localAutoLogin({
      ...LOCAL,
      LOCAL_AUTOLOGIN_EMAIL: 'inacio@example.com',
      LOCAL_AUTOLOGIN_PASSWORD: 'something-else',
    }),
  ).toEqual({ email: 'inacio@example.com', password: 'something-else' })
})
