// Generates (or removes) a local-only demo household: two years of income,
// investments, fixed and variable spending, instalments, a few uncategorized
// rows, and a plan for every category.
//
// It exists because the features this app was built for — Receita vs plan, the
// year grid, pacing, "Comprometido" — are all invisible against a database
// that holds nothing but a card's spending. Verifying them by hand-typing
// figures is how a screen ends up tested only on the one month someone
// bothered to fill in.
//
// LOCAL ONLY, enforced rather than documented: see assertLocalDatabase. This
// writes invented salaries, and on a real household's database that is not
// test data, it is corruption of the only record they have.
//
// Driven by ./seed.sh --demo | --demo-clear | --demo-if-empty.

import { eq, sql } from 'drizzle-orm'
import { createDb } from './lib/db/client'
import { accounts, connections, households, transactions } from './lib/db/schema'
import { assertLocalDatabase, clearDemoData, seedDemoData } from './lib/demo/seed'

const url = process.env.DATABASE_URL
const mode = process.env.DEMO_MODE ?? 'seed'

function fail(message: string): never {
  console.error(`Error: ${message}`)
  process.exit(1)
}

if (!url) fail('DATABASE_URL is not set.')

try {
  assertLocalDatabase(url)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

const { db, sql: connection } = createDb(url)

try {
  const [household] = await db.select({ id: households.id }).from(households).limit(1)
  if (!household) {
    fail('No household yet. Run ./seed.sh first, then ask for demo data.')
  }

  if (mode === 'clear') {
    const { removedTransactions, removedPlans } = await clearDemoData(db, household.id)
    console.log(`Removed ${removedTransactions} demo transactions and ${removedPlans} demo plans.`)
    console.log('Nothing synced from a real bank was touched.')
    console.log('demo-result: cleared')
  } else {
    // `if-empty` is what ./start.sh uses. A household that already has
    // transactions — real ones, or a previous demo — is left alone: a boot
    // must never invent financial figures on top of existing ones.
    if (mode === 'if-empty') {
      const [{ count }] = await db
        .select({ count: sql<string>`count(*)` })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .innerJoin(connections, eq(accounts.connectionId, connections.id))
        .where(eq(connections.householdId, household.id))

      if (Number(count) > 0) {
        console.log(`Household already has ${count} transactions — left unchanged.`)
        console.log('demo-result: skipped')
        process.exit(0)
      }
    }

    const result = await seedDemoData(db, household.id)
    console.log(
      `Wrote ${result.transactions} demo transactions (${result.from} → ${result.to}) ` +
        `and ${result.plans} plans.`,
    )
    console.log('demo-result: seeded')
  }
} finally {
  await connection.end()
}
