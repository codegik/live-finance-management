import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Db = ReturnType<typeof createDb>['db']

/**
 * A database handle that may or may not be inside a transaction.
 *
 * Rule creation writes the rule and backfills its transactions in one
 * database transaction, so the query helpers it calls must accept the
 * transaction handle rather than the pool. Deriving the type from
 * Db['transaction'] keeps it correct if the driver changes.
 */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

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
