import { sql as raw } from 'drizzle-orm'
import { inject, vi } from 'vitest'
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
}
