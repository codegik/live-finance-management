import { sql as raw } from 'drizzle-orm'
import { inject } from 'vitest'
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
