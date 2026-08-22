import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Db = ReturnType<typeof createDb>['db']

export function createDb(url: string) {
  const sql = postgres(url, { max: 5 })
  return { db: drizzle(sql, { schema }), sql }
}

let cached: ReturnType<typeof createDb> | undefined

export function getDb() {
  if (!cached) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    cached = createDb(url)
  }
  return cached.db
}
