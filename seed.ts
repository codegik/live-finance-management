// Creates the first household and its owner.
//
// The app's registration is invite-only by design: every other user joins via
// an invite created by someone already signed in. That leaves nothing to
// create the *first* household, so this script does it — going through the
// same createHousehold() and hashPassword() the app uses, rather than writing
// rows by hand, so a schema change breaks this loudly instead of silently
// seeding something the app cannot read.
//
// Idempotent: if the account already exists it is left exactly as it is, so
// this is safe to run on every ./start.sh. Changing an existing password is a
// separate, explicit act — SEED_RESET=true (./seed.sh --reset-password).
//
// Driven by ./seed.sh, which supplies the environment.

import { eq } from 'drizzle-orm'
import { hashPassword } from './lib/auth/password'
import { createDb } from './lib/db/client'
import { createHousehold } from './lib/db/households'
import { users } from './lib/db/schema'

const url = process.env.DATABASE_URL
const email = (process.env.SEED_EMAIL ?? '').trim().toLowerCase()
const password = process.env.SEED_PASSWORD ?? ''
const name = (process.env.SEED_NAME ?? 'Owner').trim()
const householdName = (process.env.SEED_HOUSEHOLD ?? 'Home').trim()
const reset = process.env.SEED_RESET === 'true'

function fail(message: string): never {
  console.error(`Error: ${message}`)
  process.exit(1)
}

if (!url) fail('DATABASE_URL is not set.')
if (!email.includes('@')) fail(`SEED_EMAIL does not look like an email: "${email}"`)
if (password.length < 8) fail('SEED_PASSWORD must be at least 8 characters.')

const { db, sql } = createDb(url)

try {
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)

  if (existing && !reset) {
    console.log(`Account ${email} already exists — left unchanged.`)
    console.log(`   household: ${existing.householdId}`)
    console.log('seed-result: exists')
  } else if (existing) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, existing.id))
    console.log(`Reset the password for ${email}.`)
    console.log(`   household: ${existing.householdId}`)
    console.log('seed-result: reset')
  } else {
    const { householdId, userId } = await createHousehold(db, {
      name: householdName,
      owner: { email, name, passwordHash: await hashPassword(password) },
    })
    console.log(`Created household "${householdName}" with owner ${email}.`)
    console.log(`   household: ${householdId}`)
    console.log(`   user:      ${userId}`)
    console.log('seed-result: created')
  }
} finally {
  await sql.end()
}
