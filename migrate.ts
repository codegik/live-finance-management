// Applies pending Drizzle migrations, then exits.
//
// Railway runs this as preDeployCommand, before the new container serves
// traffic. It deliberately does not use drizzle-kit: that is a devDependency
// and a whole CLI, neither of which belongs in a production image. The
// migrator here comes from drizzle-orm, which is already a runtime dependency
// — the same one tests/globalSetup.ts uses to prepare the test database.

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Error: DATABASE_URL is not set.')
  process.exit(1)
}

// max: 1 because migrations must run in order on one connection.
const sql = postgres(url, { max: 1 })

try {
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' })
  console.log('migrations applied')
} catch (error) {
  // Exit non-zero so the deploy stops here rather than starting a container
  // against a schema that does not match the code.
  console.error('migration failed', error)
  process.exitCode = 1
} finally {
  await sql.end()
}
