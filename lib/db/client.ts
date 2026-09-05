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
  // Fly runs this app with auto_stop_machines = "suspend", which freezes the
  // VM (and every JS timer) while idle. A pooled socket left open across a
  // suspend is dead on resume — the DB peer has already reset it — so the
  // first query after wake-up throws `read ECONNRESET`. idle_timeout closes
  // idle connections during the pre-suspend idle window so nothing stale
  // survives into suspension; max_lifetime recycles long-lived connections;
  // connect_timeout bounds the reconnect on resume.
  const sql = postgres(url, {
    max: 5,
    idle_timeout: 20, // seconds a connection may sit idle before it's closed
    max_lifetime: 60 * 30, // recycle each connection after 30 minutes
    connect_timeout: 10, // fail fast instead of hanging on a bad socket
  })
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
