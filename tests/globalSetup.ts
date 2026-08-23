import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import type { GlobalSetupContext } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}

let container: StartedPostgreSqlContainer

export async function setup({ provide }: GlobalSetupContext) {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  const url = container.getConnectionUri()

  const sql = postgres(url, { max: 1 })
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' })
  await sql.end()

  provide('databaseUrl', url)
}

export async function teardown() {
  await container?.stop()
}
