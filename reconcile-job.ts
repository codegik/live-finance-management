// The nightly reconcile, as a one-shot process.
//
// Railway runs a cron service by executing its start command on a schedule and
// expects the process to terminate. That fits the reconcile exactly: it does
// its work and exits, so nothing is held open between runs.
//
// This calls reconcileAll directly rather than making an HTTP request to
// /api/cron/reconcile. That removes the shared secret from the picture
// entirely, drops a network hop, and means a slow reconcile cannot be cut off
// by a request timeout. The HTTP route stays for triggering a run by hand.
//
// Exit code is the signal Railway records: 0 when every connection synced,
// 1 when any failed, so a broken card shows up as a failed run rather than a
// green one with bad news buried in the logs.

import { createDb } from './lib/db/client'
import { loadEnv } from './lib/env'
import { createPluggyClient } from './lib/pluggy/client'
import { reconcileAll } from './lib/sync/reconcile'

const env = loadEnv()
const { db, sql } = createDb(env.DATABASE_URL)

try {
  const pluggy = createPluggyClient({
    apiUrl: env.PLUGGY_API_URL,
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
  })

  const { succeeded, failed } = await reconcileAll(db, pluggy)
  console.log(`reconcile finished: ${succeeded.length} succeeded, ${failed.length} failed`)

  if (failed.length > 0) {
    console.error('connections that failed to sync', failed)
    process.exitCode = 1
  }
} catch (error) {
  // A failure here means no connection was reconciled at all — louder than a
  // partial failure, and it must not exit 0.
  console.error('reconcile aborted', error)
  process.exitCode = 1
} finally {
  await sql.end()
}
