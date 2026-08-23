import { expect, it } from 'vitest'
import { loadEnv } from '@/lib/env'

const valid = {
  DATABASE_URL: 'postgres://user:pw@localhost:5432/db',
  AUTH_SECRET: 'PGH4vD8mQ2sXbN7kR1tYwZ3aC5eF9gJ0',
  PLUGGY_CLIENT_ID: 'a-real-client-id',
  PLUGGY_CLIENT_SECRET: 'a-real-client-secret',
  PLUGGY_API_URL: 'https://api.pluggy.ai',
  PLUGGY_WEBHOOK_TOKEN: 'Kd7Rm2Xq9Tz4Vb1Nc6Hs8Jw3Ly5Pg0A',
  CRON_SECRET: 'Qw9Er2Ty4Ui6Op8As1Df3Gh5Jk7Lz0X',
}

it('accepts a fully populated environment', () => {
  expect(() => loadEnv(valid as NodeJS.ProcessEnv)).not.toThrow()
})

it('rejects the published .env.example placeholder even though it is long enough', () => {
  // 36 characters, so a min(16) check passes it. It is printed in a committed
  // file, so a deployment running on it has no secret at all.
  const placeholder = 'generate-with-openssl-rand-base64-32'
  expect(placeholder.length).toBeGreaterThan(16)

  expect(() =>
    loadEnv({ ...valid, AUTH_SECRET: placeholder } as NodeJS.ProcessEnv),
  ).toThrow(/placeholder/i)
})

it('rejects CHANGE_ME in any of the secrets', () => {
  for (const key of ['AUTH_SECRET', 'PLUGGY_WEBHOOK_TOKEN', 'CRON_SECRET'] as const) {
    expect(() =>
      loadEnv({ ...valid, [key]: 'CHANGE_ME' } as NodeJS.ProcessEnv),
    ).toThrow(/placeholder/i)
  }
})

it('rejects a CHANGE_ME variant with a suffix', () => {
  expect(() =>
    loadEnv({ ...valid, CRON_SECRET: 'CHANGE_ME_CRON_SECRET_PLEASE' } as NodeJS.ProcessEnv),
  ).toThrow(/placeholder/i)
})

it('rejects the Pluggy credential placeholders', () => {
  expect(() =>
    loadEnv({ ...valid, PLUGGY_CLIENT_ID: 'replace-with-your-pluggy-client-id' } as NodeJS.ProcessEnv),
  ).toThrow(/placeholder/i)
})
