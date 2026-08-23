import { sql as raw } from 'drizzle-orm'
import { afterEach, inject, vi } from 'vitest'
import { createDb, type Db } from '@/lib/db/client'

let handle: ReturnType<typeof createDb> | undefined

export function testDb(): Db {
  if (!handle) handle = createDb(inject('databaseUrl'))
  return handle.db
}

export async function resetDb(): Promise<void> {
  const db = testDb()
  const tables = await db.execute<{ tablename: string }>(
    raw`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
  )
  const names = tables.map((r) => `"${r.tablename}"`).join(', ')
  if (names) await db.execute(raw.raw(`truncate table ${names} restart identity cascade`))
}

export function useTestEnv(): void {
  vi.stubEnv('DATABASE_URL', inject('databaseUrl'))
  vi.stubEnv('AUTH_SECRET', 'test-auth-secret-value')
  vi.stubEnv('PLUGGY_API_URL', 'https://api.pluggy.test')
  vi.stubEnv('PLUGGY_CLIENT_ID', 'client-id')
  vi.stubEnv('PLUGGY_CLIENT_SECRET', 'client-secret')
  vi.stubEnv('PLUGGY_WEBHOOK_TOKEN', 'webhook-token-value-1234')
  vi.stubEnv('CRON_SECRET', 'cron-secret-value-1234')
  vi.stubEnv('RESEND_API_KEY', 're_test_key')
  vi.stubEnv('ALERT_EMAIL_FROM', 'alerts@example.com')
}

// useTestEnv() stubs process.env for the duration of a test. All test files
// share one worker process (pool: 'forks', singleFork: true), so without
// teardown a stub set by one file's test would still be visible to the next
// test that runs in that process -- including tests in other files. This
// helper owns the stubs it creates, so it owns unstubbing them too: this
// afterEach is registered once per test file (module state resets between
// files under the default `isolate: true`), and unstubAllEnvs() is a no-op
// for files that never call useTestEnv().
afterEach(() => {
  vi.unstubAllEnvs()
})
